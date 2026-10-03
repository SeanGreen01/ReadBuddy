import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Reader from "../components/Reader";

const { connect, connections } = vi.hoisted(() => ({
  connect: vi.fn(),
  connections: [] as { emit: (event: string, payload?: unknown) => void; close: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@elevenlabs/client", () => ({
  CommitStrategy: { VAD: "vad" },
  RealtimeEvents: { SESSION_STARTED: "ready", PARTIAL_TRANSCRIPT: "partial",
    COMMITTED_TRANSCRIPT: "committed", ERROR: "error", CLOSE: "close" },
  Scribe: { connect },
}));

beforeEach(() => {
  connections.length = 0;
  connect.mockImplementation(() => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const connection = {
      on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
      emit: (event: string, payload: unknown = {}) => handlers.get(event)?.(payload),
      close: vi.fn(),
    };
    connections.push(connection);
    return connection;
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "temporary" }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("offers Stop during connection setup and stays stopped after late readiness", async () => {
  render(<Reader />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Let’s read" })); });
  expect(screen.getByText("Starting microphone…")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Stop reading" }));
  act(() => connections[0].emit("ready"));
  expect(screen.getByRole("button", { name: "Let’s read" })).toBeDefined();
  expect(connections[0].close).toHaveBeenCalledOnce();
});

it("Read again starts the passage from the beginning under Strict Mode", async () => {
  render(<StrictMode><Reader /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Choose a story" }));
  fireEvent.click(screen.getByText("Add your own text"));
  fireEvent.change(screen.getByLabelText("Passage text"), { target: { value: "Go home." } });
  fireEvent.click(screen.getByRole("button", { name: "Use this passage" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Let’s read" })); });
  act(() => {
    connections[0].emit("ready");
    connections[0].emit("committed", { text: "go home" });
  });
  expect(screen.getByText("You finished the story!")).toBeDefined();
  expect(connections[0].close).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Read again" })); });
  act(() => connections[1].emit("ready"));
  expect(document.querySelector('[aria-current="true"]')?.textContent?.trim()).toBe("Go");
  expect(screen.queryByText("You finished the story!")).toBeNull();
});

it("unmount closes the active microphone", async () => {
  const { unmount } = render(<Reader />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Let’s read" })); });
  act(() => connections[0].emit("ready"));
  unmount();
  expect(connections[0].close).toHaveBeenCalledOnce();
});

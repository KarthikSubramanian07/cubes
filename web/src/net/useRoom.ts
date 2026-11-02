import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ClientMsg } from "./protocol";
import { RoomClient, type RoomClientOptions, type RoomState } from "./RoomClient";

const IDLE: RoomState = {
  status: "idle",
  lobby: null,
  view: null,
  me: null,
  clock: null,
  chat: [],
  error: null,
  latency: null,
  replay: null,
};

export interface UseRoom extends RoomState {
  send: (msg: ClientMsg) => void;
  client: RoomClient | null;
}

/**
 * Join room `code` as `name` for the lifetime of the component. Renaming
 * keeps the connection; changing the code reconnects.
 */
export function useRoom(
  code: string | null,
  name: string,
  opts?: Omit<RoomClientOptions, "code" | "name">,
): UseRoom {
  const [client, setClient] = useState<RoomClient | null>(null);

  useEffect(() => {
    if (!code) return;
    const c = new RoomClient({ ...opts, code, name });
    setClient(c);
    c.connect();
    return () => {
      c.close();
      setClient(null);
    };
    // The name is applied below without reconnecting; opts are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    const me = client?.state.me;
    if (client && me && name.trim()) client.send({ t: "rename", name });
    // Only when the name changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const subscribe = useCallback(
    (cb: () => void) => (client ? client.on("state", cb) : () => {}),
    [client],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => client?.state ?? IDLE,
    () => IDLE,
  );
  const send = useCallback((msg: ClientMsg) => client?.send(msg), [client]);
  return { ...state, send, client };
}

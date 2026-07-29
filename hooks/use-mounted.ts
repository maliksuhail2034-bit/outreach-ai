import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

// True once hydrated on the client, false during SSR — without calling
// setState inside an effect (flagged by the React Compiler's
// set-state-in-effect rule). getSnapshot/getServerSnapshot never change, so
// subscribe never needs to notify anything.
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

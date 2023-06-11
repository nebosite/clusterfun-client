// HACK/FAILED POC: This is supposed up the full set of SharedWorkers our app uses,
// doing nothing more than keeping them alive for 10 seconds.
// As demonstrated, even this is too late for the "load as early as possible" strategy.

import gameList from "./games/lists/gamesListDebug";

const workers = new Set();

for (const game of gameList) {
    workers.add(game.hostWorkerThunk())
}

workers.add(/* webpackChunkName: "test-room-manager" */ new SharedWorker(new URL("./testLobby/workers/LocalRoomManagerWorker", import.meta.url), { type: "module" }));

setTimeout(() => {
    workers.clear();
}, 10000);

export {};
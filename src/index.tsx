import Logger from "js-logger";
import { createRoot } from "react-dom/client";
import { GLOBALS } from "./Globals";
import { getGameListPromise } from "GameChooser";
import { GameManifestItem, LobbyGame } from "games/lists/GameDescriptor";
import { fetchPopularity, sortGamesByPopularity } from "games/lists/gamePopularity";
import { GameInstanceProperties } from "libs/config/GameInstanceProperties";
import { WebSocketMessageThing } from "libs/messaging/MessageThing";
import { GameAnalytics } from "libs/telemetry/GameAnalytics";
import { getDeviceId } from "libs/telemetry/DeviceId";
import { configureErrorReporter, installGlobalErrorHandlers } from "libs/telemetry/ErrorReporter";
import "index.css";
import React from "react";

// auto-redirect http to http on the prod server
if (window.location.href.toLowerCase().startsWith("http://clusterfun.tv")) {
  window.location.replace(`https:${window.location.href.substring(5)}`);
}

// Configure logging levels here
// TODO: While in production, set default log level to WARN/ERROR
// eslint-disable-next-line
Logger.useDefaults();
if (process.env.REACT_APP_DEVMODE === "development") {
  Logger.setLevel(Logger.DEBUG);
} else {
  Logger.setLevel(Logger.WARN);
}

const rootContainer = document.getElementById("root") as HTMLElement;
const root = createRoot(rootContainer);

document.title = GLOBALS.Title;

Logger.debug(`MOBILE: ${GLOBALS.IsMobile}`);
// -------------------------------------------------------------------
// _serverCall
// -------------------------------------------------------------------
async function serverCall<T>(url: string, payload: any | undefined) {
  if (payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: [["Content-Type", "application/json"]],
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      return (await response.json()) as T;
    } else {
      const responseBody = await response.text();
      throw new Error("Failed to connect to game: " + responseBody);
    }
  } else {
    const response = await fetch(url, { method: "GET" });
    if (response.ok) {
      const streamText = await response.text();
      return (await JSON.parse(streamText)) as T;
    } else {
      const responseBody = await response.text();
      throw new Error("Server call failed" + responseBody);
    }
  }
}

// Real analytics run whenever the build asks for them and nothing has opted
// out.  .env.production sets the flag, so a production build reports for real
// without anyone having to remember a command-line variable; the Test Lobby
// (.env.dev) leaves it unset and gets the console-logging mock.
const useRealTelemetry =
  !!process.env.REACT_APP_USE_REAL_TELEMETRY && !process.env.REACT_APP_NO_TELEMETRY;

const telemetryFactoryPromise = (async () => {
  if (useRealTelemetry) {
    const realModulePromise = import("./libs/telemetry/TelemetryLogger");
    const googleTrackingIds = (await import("./secrets")).googleTrackingIds;
    const TelemetryLoggerFactory = (await realModulePromise).TelemetryLoggerFactory;
    return new TelemetryLoggerFactory(googleTrackingIds);
  } else {
    const mockModulePromise = import("./libs/telemetry/MockTelemetryLogger");
    const MockTelemetryLoggerFactory = (await mockModulePromise).MockTelemetryLoggerFactory;
    return new MockTelemetryLoggerFactory();
  }
})();

const getStoragePromise = (async () => (await import("./libs/storage/StorageHelper")).getStorage)();

// Crash reporting, armed as early as we can.
//
// An error boundary only sees errors thrown while rendering.  Everything else - a throw from
// an event handler or a timer, a promise nobody awaited, anything that happens before the
// first game model exists - reaches nobody at all without these two listeners.  Installed
// synchronously so a failure during startup is still caught; the analytics channel is
// attached a moment later, and reportError holds nothing until it arrives.
installGlobalErrorHandlers();
(async () => {
  const factory = await telemetryFactoryPromise;
  const getStorage = await getStoragePromise;
  configureErrorReporter(
    new GameAnalytics(factory.getLogger("Lobby"), {
      game: "Lobby",
      deviceId: getDeviceId(getStorage("clusterfun")),
      entity: "lobby",
    }),
  );
})();

// Get the google analitics measurement ID from :  https://analytics.google.com/analytics/web/#/a169765098p268496630/admin/streams/table/2416371752

const quickTest = process.env.REACT_APP_QUICKTEST ?? false;
// -------------------------------------------------------------------
// Development: Render test Lobby
// -------------------------------------------------------------------
if (quickTest) {
  (async () => {
    const QuickTestComponent = (await import("./testLobby/Components/QuickTestComponent"))
      .QuickTestComponent;
    root.render(<QuickTestComponent />);
  })();
} else if (process.env.REACT_APP_DEVMODE === "development") {
  (async () => {
    const gameTestModuleTypePromise = import("./testLobby/models/GameTestModel");
    const gameListPromise = getGameListPromise();
    const gameTestComponentPromise = import("./testLobby/Components/GameTestComponent");
    const GameTestModel = (await gameTestModuleTypePromise).GameTestModel;
    const GameTestComponent = (await gameTestComponentPromise).GameTestComponent;
    const gameList = await gameListPromise;
    const getStorage = await getStoragePromise;

    const factory = await telemetryFactoryPromise;

    const gameTestModel = new GameTestModel(4, getStorage("clusterfun_test"), factory);

    // No server manifest outside production, so nothing is badged and
    // every game the build knows about is visible.
    const games: LobbyGame[] = gameList.map((g) => ({ ...g, tags: [] }));

    root.render(<GameTestComponent gameTestModel={gameTestModel} games={games} />);
  })();
}

// -------------------------------------------------------------------
// Production: Render Lobby
// -------------------------------------------------------------------
else {
  (async () => {
    Logger.info(`------- PAGE RELOAD -------------------`);

    const LobbyModel = (await import("./lobby/models/LobbyModel")).LobbyModel;
    const LobbyMainPage = (await import("./lobby/views/LobbyMainPage")).LobbyMainPage;
    const WebSocketMessageThing_class = (await import("./libs/messaging/MessageThing"))
      .WebSocketMessageThing;
    const telemetryFactory = await telemetryFactoryPromise;
    const getStorage = await getStoragePromise;

    let cachedMessageThings = new Map<string, WebSocketMessageThing>();
    const lobbyModel = new LobbyModel(
      {
        messageThingFactory: (gp: GameInstanceProperties) => {
          let cachedThing = cachedMessageThings.get(gp.personalSecret);
          if (!cachedThing || cachedThing.isClosed) {
            Logger.debug(`Caching a new web socket for ${gp.personalSecret}...`);
            cachedThing = new WebSocketMessageThing_class(
              gp.roomId,
              gp.personalId,
              gp.personalSecret,
            );
            cachedMessageThings.set(gp.personalSecret, cachedThing);
          }
          return cachedThing;
        },
        serverCall: serverCall,
        storage: getStorage("clusterfun"),
        telemetryFactory,
        onGameEnded: () => {},
      },
      "mainLobby",
    );

    const getGameManifest = async () => {
      const response = await fetch("/api/game_manifest", { method: "GET" });
      if (response.ok) {
        const streamText = await response.text();
        return (await JSON.parse(streamText)) as GameManifestItem[];
      } else {
        return [] as GameManifestItem[];
      }
    };

    try {
      var gamesFromServerManifest: GameManifestItem[] = await getGameManifest();
    } catch (err) {
      root.render(
        <div>There was a problem trying to load clusterfun. Please try again later. </div>,
      );
      return;
    }

    const allGames = await getGameListPromise();
    // What people actually play decides the order of the lobby.  Fetched
    // alongside the manifest; if it is unavailable the registry order stands.
    const popularity = await fetchPopularity();
    const gameList = gamesFromServerManifest
      .map((serverItem) => {
        const foundGame = allGames.find(
          (g) => g.name.toLowerCase() === serverItem.name.toLowerCase(),
        );
        if (foundGame) {
          // The manifest is the authority: it decides the label the lobby
          // shows, and may override the client's display name.
          const addMe: LobbyGame = { ...foundGame, tags: serverItem.tags };
          if (serverItem.displayName) addMe.displayName = serverItem.displayName;
          return addMe;
        } else {
          Logger.warn(`Server specified a game I don't know about: ${serverItem.name}`);
          return undefined;
        }
      })
      .filter((i) => i !== undefined) as LobbyGame[];

    root.render(
      <LobbyMainPage lobbyModel={lobbyModel} games={sortGamesByPopularity(gameList, popularity)} />,
    );
  })();
  root.render(<div>Loading stuff....</div>);
}

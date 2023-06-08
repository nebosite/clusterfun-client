import React from "react";
import { observer } from "mobx-react";
import * as Comlink from "comlink";
import { ITestatoHostWorkerLifecycleController } from "games/TestGame/workers/IHostWorkerLifecycleController";
import { IClusterfunHostGameControllerBundle, IClusterfunHostGameInitializer } from "libs/worker/IClusterfunHostGameInitializer";
import { GameInstanceProperties } from "libs/config/GameInstanceProperties";
import { GameRole } from "libs/config/GameRole";

class QuickState {
    initializer = Comlink.wrap(/* webpackChunkName: "quick-test-worker" */ new Worker(new URL("../../games/TestGame/workers/HostWorker", import.meta.url), { type: "module" })) as 
        unknown as Comlink.Remote<IClusterfunHostGameInitializer<ITestatoHostWorkerLifecycleController>>;
    controller?: Comlink.Remote<ITestatoHostWorkerLifecycleController>;
    roomId?: string;
}

// -------------------------------------------------------------------
// ClientComponent
// -------------------------------------------------------------------
@observer export class QuickTestComponent extends React.Component {
    st = new QuickState();

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {

        const generateController = async () => {
            const port = new MessageChannel().port1;
            console.log("Requesting init");
            const bundle = await this.st.initializer.init(
                Comlink.proxy(function serverCall<T>(url: string, payload: any): Promise<T> {
                    if(url===("/api/startgame")) {
                        const gameProperties: GameInstanceProperties = {
                            gameName: payload.gameName,
                            role: GameRole.Host,
                            roomId: ["BEEF", "FIRE", "SHIP", "PORT", "SEAT"][Math.floor(Math.random() * 5)],
                            hostId: "host_id",
                            personalId: "host_id",
                            personalSecret: "host_secret"
                        }
                        return Promise.resolve(gameProperties as unknown as T);
                    } else {
                        throw new Error("Unknown API " + url);
                    }
                 }),
                Comlink.transfer(port, [port]),
                Comlink.proxy(() => {})
            );
            this.st.controller = Comlink.wrap(bundle.lifecycleControllerPort) as Comlink.Remote<ITestatoHostWorkerLifecycleController>;
            this.st.roomId = bundle.roomId;
            console.log("Controller successfully obtained", this.st.controller);
            this.forceUpdate();
        }

        return (
            <div >
                { !!this.st.roomId && <div>{this.st.roomId}</div>}
                { !!this.st.controller
                    ? (
                        <button onClick={() => this.st.controller!.startGame()}>Start Game</button>
                    )
                    : (
                        <button onClick={generateController}>Generate Controller</button>
                    ) 
                }

            </div>
        )
    }        
}

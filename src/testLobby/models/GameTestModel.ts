import { action, makeObservable, observable } from "mobx";
import { LobbyModel, ILobbyDependencies } from "../../lobby/models/LobbyModel";
import { LocalMessageThing, ITelemetryLoggerFactory, IStorage, IMessageThing, getStorage, GameInstanceProperties } from "../../libs";
import Logger from "js-logger";
import { GameRole } from "libs/config/GameRole";

const names = [
    // Names with weird latin characters
    "Günay","Marta","Giano","Amna","Hilal","Þórbjǫrg","Justína","Maia","Daniel","Iulius","Avgust","Aitana","Radosława","Stanislav","Govinda","Adela",
    "Enrica","Pan","Hróðólfr","Veit","Nərgiz","Josef","Silvio","Kaltrina","Varuna","Carloman","Ilia","Harsh","Tarou","Pravin","Wisdom","Xavia","Krešimir",
    "Ronja","Alya","Lúcia","Judda","'Orpah","Idalia","Amit","Eline","Blair","Hartmann","Maela","Iosephus","Galla","Emmerich","Audamar","Moonshinepusher",
    "Erlend","Chander","Quintillus","Hild","Loreto","Yusef","Leudoberct","Mirabelle","Murali","Neeraj","Laius","Gemariah","Veselin","Diamond","Indriði",
    "Bjoern","Anaru","Niles","Yarona","Hippokrates","Jarosława",

    // Double-byte names
    "Christy","克里斯蒂","Cindy","辛迪","Claire","克莱尔","Clara","克莱拉","Claudia","克劳迪娅","Constance","康斯坦斯","Courtney","考特尼","Cynthia","辛西娅",
    "Daisy","戴西","Dalila","达利拉","Dana","丹娜","Daniela","丹涅拉","Danielle","丹妮尔","Daphne","达芙妮","Deborah","黛博拉","Denise","丹妮丝","Destiny",
    "黛丝蒂妮","Diana","黛安娜","Diane","黛安","Dina","迪娜","Donna","唐娜","Doreen","多琳","Dorian","多里安","Edna","艾德娜","Eileen","艾琳","Elena","伊莲娜",
    "Elisa","爱丽莎","Elisabeth","伊丽莎白","Elise","爱丽丝","Elizabeth","伊丽莎白","Ella","艾拉","Elle","艾莉","Ellen","艾伦","Eloise","艾萝依","Elora","伊劳拉",
    "Elsa","艾尔莎","Elyse","艾丽丝","Emily","艾米莉","Emma","艾玛","Erica","艾丽卡","Erika","艾丽卡","Eve","伊夫","Eveline","艾维琳","Evelyn","艾芙琳",

    // Random names
    "Abhinav","Afif","Aislin","Alihan","Anaely","Analeah","Angelisse","Anirudh","Arion","Arlon","Augustin","Ausha","Avnoor",
    "Ayah","Azariel","Brex","Bryley","Calee","Cameron","Carisa","Cayde","Cayliana","Chistopher","Copper","Cosmo","Denae","Denasia",
    "Dimas","Ecclesia","Efrata","Evienne","Felton","Fuad","Gertrude","Haneef","Hill","Hudeyfa","Hunter","Izac","Izyan","Jaedyn",
    "Jalaya","Jamesyn","Jesaiah","Karizma","Katriel","Kayliah","Keivon","Kemarion","Kendyn","Kentlee","Keylin","Khenan","Kiarah","Kiri",
    "Kmya","Lanai","Landynn","Laylah","Layoni","Lazarus","Leighanna","Lockwood","Lorik","Madelinn","Makinsley","Margeaux","Marleyah",
    "Meilani","Melannie","Moiz","Muhannad","Naol","Nimrit","Noble","Noctis","Omkar","Paola","Princetin","Rahyl","Raven","Reminisce",
    "Rorie","Ryanna","Saryiah","Shavy","Sky","Starling","Sue","Tahari","Talulah","Taylon","Terriyah","Tevita","Tifeoluwa","Tyliyah",
    "Viktor","Yalexi","Zikra","Zunairah", "Eric", "Janet", "David", "Hans", "Leif", "Freja", "Britta", "Inge"]

// -------------------------------------------------------------------
// The LobbyModel
// -------------------------------------------------------------------
export class GameTestModel {
    @observable _presenterSize: number = 0;
    get presenterSize() {return this._presenterSize;}
    set presenterSize(value: number) { action(()=>{this._presenterSize = value; this.saveState()})()}

    @observable  private _gameName = ""
    get gameName() {return this._gameName}
    set gameName(value) {action(()=>{this._gameName = value})()}
    
    clientModels = observable(new Array<LobbyModel>())
    joinCount = 0;

    @observable  private _presenterModel:LobbyModel = {} as LobbyModel
    get presenterModel() {return this._presenterModel}
    set presenterModel(value) {action(()=>{this._presenterModel = value})()}
    
    private _roomInhabitants = new Map<string, LocalMessageThing>();

    private _loggerFactory: ITelemetryLoggerFactory;
    private _storage: IStorage;
    
    private _cachedMessageThings = new  Map<string, IMessageThing>();

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(numberOfClients: number, storage: IStorage, loggerFactory: ITelemetryLoggerFactory)
    {
        makeObservable(this);

        this._storage = storage;
        this._loggerFactory = loggerFactory;
        this.loadState();

        this.presenterModel = new LobbyModel(
            {
                messageThingFactory: (gp) => this.getMessageThing(gp.personalId, "Mr Presenter"),
                serverCall: this.serverCall,
                storage: getStorage("test_presenter"),
                telemetryFactory: this._loggerFactory,
                onGameEnded: () =>{
                    this.joinCount = 0;
                    this._cachedMessageThings.clear();
                }
            }, 
            "presenterLobby");
        this.presenterModel.playerName = "Mr Presenter";
            
        for(let i = 0; i < numberOfClients; i++)  {
            const clientName =  names[Math.floor(Math.random() * names.length)];
            const newLobby = new LobbyModel(this.makeLobbyDependencies(i, clientName), "client" + i)
            if(!newLobby.gameProperties) newLobby.playerName = clientName;
            this.clientModels.push(newLobby)
        }
    }

    // -------------------------------------------------------------------
    // makeLobbyDependencies
    // -------------------------------------------------------------------
    private makeLobbyDependencies(clientNumber: number, clientName: string)
    {
        const dependencies: ILobbyDependencies =
        {
            messageThingFactory: (gp) => this.getMessageThing(gp.personalId, clientName),
            serverCall: this.serverCall,
            storage: getStorage(`test_client_${clientNumber}`),
            telemetryFactory: this._loggerFactory,
            onGameEnded : () => {},
        }
        return dependencies;
    }

    // -------------------------------------------------------------------
    // getMessageThing
    // -------------------------------------------------------------------
    getMessageThing(id: string, name: string) {
        if(!this._cachedMessageThings.has(id)){
            const newThing = new LocalMessageThing( this._roomInhabitants, id, 10, 20)
            this._cachedMessageThings.set( id, newThing)
        }
        return this._cachedMessageThings.get(id)!;
    }


    // -------------------------------------------------------------------
    // serverCall
    // -------------------------------------------------------------------
    private serverCall = <T>(url: string, payload: any) : Promise<T> =>
    {
        if(url===("/api/startgame")) {
            const gameProperties: GameInstanceProperties = {
                gameName: payload.gameName,
                role: GameRole.Host,
                roomId: ["BEEF", "FIRE", "SHIP", "PORT", "SEAT"][Math.floor(Math.random() * 5)],
                hostId: "host_id",
                personalId: "host_id",
                personalSecret: "host_secret"
            }       
            this.gameName = payload.gameName;
            this.clientModels.forEach(m => m.roomId = gameProperties.roomId);  
            this.saveState();
            return Promise.resolve(gameProperties as unknown as T);
        }
        else if(url===("/api/am_i_healthy")) {
            const healthdata = {
                version: "99.99.99",
                uptime: "0 00:04:37",
                rooms: {
                    roomCount: 12,
                    activeRooms: 8,
                    activeUsers: 22
                },
                summary: [
                    {
                      label: "GetRequest_ROOT",
                      data: {
                        count: 27377,
                        sum: 0
                      }
                    },
                    {
                      label: "MessageSend",
                      data: {
                        count: 32364,
                        sum: 9061270
                      }
                    },
                    {
                      label: "MessageReceive",
                      data: {
                        count: 32305,
                        sum: 9053536
                      }
                    },
                    {
                      label: "GeneralError_Join invalid room id",
                      data: {
                        count: 12,
                        sum: 0
                      }
                    },
                    {
                      label: "GeneralError_roomJoinError",
                      data: {
                        count: 12,
                        sum: 0
                      }
                    }
                  ],
                  series: [
                        {
                        date: 1667319600000,
                        columns: [
                                {
                                label: "GetRequest_ROOT",
                                    data: {
                                        count: 1,
                                        sum: 0
                                    }
                                }
                            ]
                        },
                    ],                                
                    cpuUsage: {
                        user: 0.11284722222221624,
                        system: 0.01495833333328142
                    },
                    memoryUsage: {
                        rss: 130777088,
                        heapTotal: 94367744,
                        heapUsed: 91789664,
                        external: 3445039,
                        arrayBuffers: 1769002
                    }
                }
            return Promise.resolve(healthdata as T);
        }
        else if(url===("/api/terminategame")) {
            Logger.info("Terminating game with room id: " + payload.roomId + " ... " + payload.hostSecret)      
            return Promise.resolve({} as T);
        }
        else if(url.startsWith("/api/joingame")) {
            // { roomId: this.roomId, playerName: this.playerName }
            const gameProperties: GameInstanceProperties = {
                gameName: this.gameName,
                role: GameRole.Client,
                roomId: payload.roomId,
                hostId: "host_id", 
                personalId: `client${this.joinCount}_id`,
                personalSecret: `client${this.joinCount}_secret`
            }       
            this.joinCount++;
            this.saveState();
            return Promise.resolve(gameProperties as unknown as T);
        }
        else throw new Error("Did not understand this url: " + url)
    }


    // -------------------------------------------------------------------
    // saveState
    // -------------------------------------------------------------------
    saveState()
    {
        const state = {
            presenterSize: this.presenterSize,
            gameName: this.gameName,
            joinCount: this.joinCount,
        }
        this._storage.set("testState", JSON.stringify(state));
    }

    // -------------------------------------------------------------------
    // loadState
    // -------------------------------------------------------------------
    loadState()
    {
        const stateJson = this._storage.get("testState");
        if(stateJson) {
            const loadedState = JSON.parse(stateJson);
            Object.assign(this, loadedState);
        }
    }
}

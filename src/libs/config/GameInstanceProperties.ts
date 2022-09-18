
export interface GameInstanceProperties {
    gameName: string;
    role: 'client' | 'presenter';
    roomId: string;
    presenterId: string;
    personalId: string;
    personalSecret: string;
}
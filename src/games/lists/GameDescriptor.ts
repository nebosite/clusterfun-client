export interface GameManifestItem { 
    name: string,
    displayName?: string, 
    tags: string[], 
}

export interface GameDescriptor extends GameManifestItem {
    logoName: string, 
    hostWorkerThunk: () => SharedWorker,
    componentImportThunk: () => Promise<{ default: React.ComponentType<any> }>
}
export interface GameManifestItem { 
    name: string,
    displayName?: string, 
    tags: string[], 
}

export interface GameDescriptor extends GameManifestItem {
    logoName: string, 
    importThunk: () => Promise<{ default: React.ComponentType<any> }>
}
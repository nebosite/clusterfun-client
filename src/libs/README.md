# libs

The framework every ClusterFun game is built on: the presenter/client base classes, the typed
messaging layer, the wire format, checkpoint serialization, and a set of shared React
components.

This is **not** a published package. It was once headed that way — the committed `.d.ts` files
next to their sources are the last trace of it — but the webpack configs and packaging scripts
have been deleted. Edit the `.ts`/`.tsx` sources.

Import from `"libs"`:

```ts
import { ClusterfunPresenterModel, MessageEndpoint, PlayerAvatar } from "libs";
```

See [CLAUDE.md](CLAUDE.md) for the folder-by-folder map, the framework rules that are easy to
get wrong, and where the test coverage is thin.

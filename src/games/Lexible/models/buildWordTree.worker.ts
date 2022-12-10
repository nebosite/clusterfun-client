import { WordTree } from './WordTree';
declare const self: DedicatedWorkerGlobalScope;
export default {} as typeof Worker & { new (): Worker };

self.onmessage = async (message: { data: {}}) => {
    const wordListPromise = import("../assets/words/Collins_Scrabble_2019");
    const badWordsPromise = import("../assets/words/badwords");

    const { wordList } = await wordListPromise;
    const wordTree = WordTree.create();
    const words = wordList.split('\n')
    for (const word of words) {
        wordTree.add(word.trim());
    }
    const wordListLength = words.length;
    const wordTreeNode = wordTree.export();

    const { badWordList } = await badWordsPromise;
    const badWords = new Set(badWordList.split('\n'));

    self.postMessage({ wordListLength, wordTreeNode, badWords });
}
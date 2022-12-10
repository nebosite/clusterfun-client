import { WordTree } from './WordTree';
declare const self: DedicatedWorkerGlobalScope;
export default {} as typeof Worker & { new (): Worker };

const CHUNK_LENGTH = 1024;

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
    const badWords = badWordList.split('\n');

    const json = JSON.stringify({ wordListLength, wordTreeNode, badWords });
    for (let i = 0; i < json.length; i += CHUNK_LENGTH) {
        self.postMessage({ done: false, i, chunk: json.substring(i, i + CHUNK_LENGTH)});
    }
    self.postMessage({ done: true });
}
// solver.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DICTIONARY_URLS = [
    'https://raw.githubusercontent.com/tabatkins/wordle-list/main/words',
    'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt'
];

const CACHE_DIR = path.join(__dirname, 'cache');

class WordleSolver {
    constructor(baseUrl, seed = 3, wordSize = 5) {
        this.baseUrl = baseUrl;
        this.seed = seed;
        this.wordSize = wordSize;
        this.possibleWords = [];

        this.apiClient = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000
        });
    }

    async loadDictionary() {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }

        const cacheFilePath = path.join(CACHE_DIR, `dictionary_${this.wordSize}letters.json`);

        if (fs.existsSync(cacheFilePath)) {
            console.log(`⚡ Loading pre-processed ${this.wordSize}-letter dictionary from cache...`);
            this.possibleWords = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
            console.log(`Loaded ${this.possibleWords.length} words. Session Seed: ${this.seed}\n`);
            return;
        }

        console.log(`📥 Downloading and merging multi-source dictionaries...`);
        try {
            const validWordRegex = new RegExp(`^[a-z]{${this.wordSize}}$`);
            const wordSet = new Set();

            const responses = await Promise.all(
                DICTIONARY_URLS.map(url => axios.get(url, { responseType: 'text' }))
            );

            for (const response of responses) {
                response.data
                    .split(/\r?\n/)
                    .map(word => word.trim().toLowerCase())
                    .filter(word => validWordRegex.test(word))
                    .forEach(word => wordSet.add(word));
            }

            this.possibleWords = Array.from(wordSet);

            fs.writeFileSync(cacheFilePath, JSON.stringify(this.possibleWords), 'utf8');
            console.log(`Saved clean JSON cache (${this.possibleWords.length} words) to: ${cacheFilePath}`);
            console.log(`Loaded ${this.possibleWords.length} words. Session Seed: ${this.seed}\n`);
        } catch (error) {
            console.error("Error loading dictionary:", error.message);
            process.exit(1);
        }
    }

    async makeGuess(guessWord) {
        try {
            const response = await this.apiClient.get('/random', {
                params: {
                    guess: guessWord,
                    size: this.wordSize,
                    seed: this.seed
                }
            });

            return response.data;
        } catch (error) {
            if (error.response) {
                console.error(`API Error ${error.response.status}:`, JSON.stringify(error.response.data));
            } else {
                console.error(`Error making guess "${guessWord}":`, error.message);
            }
            process.exit(1);
        }
    }

    /**
     * Robust candidate filtering supporting Votee API feedback quirks.
     */
    filterWords(feedback) {
        const exactPos = new Array(this.wordSize).fill(null);
        const wrongPos = Array.from({ length: this.wordSize }, () => new Set());
        const requiredChars = new Set();
        const forbiddenChars = new Set();

        for (const { slot, guess: char, result } of feedback) {
            if (result === 'correct') {
                exactPos[slot] = char;
                requiredChars.add(char);
            } else if (result === 'present') {
                wrongPos[slot].add(char);
                requiredChars.add(char);
            } else if (result === 'absent') {
                wrongPos[slot].add(char);
                forbiddenChars.add(char);
            }
        }

        // If a character was marked correct or present anywhere, it cannot be forbidden
        for (const char of requiredChars) {
            forbiddenChars.delete(char);
        }

        // Count minimum occurrences strictly based on DISTINCT 'correct' slot positions
        const correctCounts = {};
        for (let i = 0; i < this.wordSize; i++) {
            if (exactPos[i]) {
                correctCounts[exactPos[i]] = (correctCounts[exactPos[i]] || 0) + 1;
            }
        }

        this.possibleWords = this.possibleWords.filter(word => {
            // 1. Positional checks (correct and wrong positions)
            for (let i = 0; i < this.wordSize; i++) {
                if (exactPos[i] && word[i] !== exactPos[i]) return false;
                if (wrongPos[i].has(word[i])) return false;
            }

            // 2. Elimination of forbidden characters
            for (let i = 0; i < this.wordSize; i++) {
                if (forbiddenChars.has(word[i])) return false;
            }

            // 3. Ensure all required characters exist in word
            for (const char of requiredChars) {
                if (!word.includes(char)) return false;
            }

            // 4. Validate exact duplicate counts for multiple 'correct' slots
            for (const char in correctCounts) {
                let count = 0;
                for (let i = 0; i < this.wordSize; i++) {
                    if (word[i] === char) count++;
                }
                if (count < correctCounts[char]) return false;
            }

            return true;
        });
    }

    getBestGuess() {
        if (this.possibleWords.length <= 2) {
            return this.possibleWords[0];
        }

        const posFreq = Array.from({ length: this.wordSize }, () => ({}));
        const letterFreq = {};

        for (const word of this.possibleWords) {
            for (let i = 0; i < this.wordSize; i++) {
                const char = word[i];
                posFreq[i][char] = (posFreq[i][char] || 0) + 1;
                letterFreq[char] = (letterFreq[char] || 0) + 1;
            }
        }

        let bestWord = this.possibleWords[0];
        let maxScore = -1;

        for (const word of this.possibleWords) {
            let score = 0;
            const seenChars = new Set();

            for (let i = 0; i < this.wordSize; i++) {
                const char = word[i];
                score += (posFreq[i][char] || 0);

                if (!seenChars.has(char)) {
                    score += (letterFreq[char] || 0) * 1.5;
                    seenChars.add(char);
                }
            }

            if (score > maxScore) {
                maxScore = score;
                bestWord = word;
            }
        }

        return bestWord;
    }

    async play() {
        await this.loadDictionary();

        let attempts = 0;
        const maxAttempts = 6;

        while (attempts < maxAttempts) {
            attempts++;

            const nextGuess = (attempts === 1 && this.wordSize === 5 && this.possibleWords.includes("salet"))
                ? "salet"
                : this.getBestGuess();

            if (!nextGuess) {
                console.log("❌ Run out of candidate words.");
                return;
            }

            console.log(`Attempt ${attempts}/${maxAttempts}: Guessing "${nextGuess.toUpperCase()}"...`);

            const feedback = await this.makeGuess(nextGuess);
            // console.log(feedback);
            const isWin = feedback.every(f => f.result === 'correct');

            if (isWin) {
                console.log(`\n🎉 Success! The word is "${nextGuess.toUpperCase()}" (Found in ${attempts} attempts)`);
                return;
            }

            this.filterWords(feedback);

            console.log(`   -> Remaining possible words: ${this.possibleWords.length}`);
            if (this.possibleWords.length <= 5 && this.possibleWords.length > 0) {
                console.log(`   -> Candidates: ${this.possibleWords.join(', ')}`);
            }
        }

        console.log("\n❌ Failed to guess the word within the allowed attempts.");
    }
}

// --- Execution ---
const API_BASE_URL = 'https://wordle.votee.dev:8000';
const solver = new WordleSolver(API_BASE_URL, 3, 5);

solver.play();
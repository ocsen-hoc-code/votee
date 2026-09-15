// solver.js
const axios = require('axios');

const DICTIONARY_URL = 'https://raw.githubusercontent.com/darkermango/5-Letter-words/main/words.txt';

class WordleSolver {
    constructor(baseUrl, seed = 10) {
        this.baseUrl = baseUrl;
        this.seed = seed;
        this.possibleWords = []; 

        // Reusable Axios instance with timeout configuration
        this.apiClient = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000
        });
    }

    /**
     * Downloads the dictionary from GitHub using a standalone request.
     */
    async loadDictionary() {
        console.log("Downloading 5-letter English dictionary...");
        try {
            const response = await axios.get(DICTIONARY_URL, { responseType: 'text' });
            
            this.possibleWords = response.data
                .split('\n')
                .map(word => word.trim().toLowerCase())
                .filter(word => word.length === 5);

            console.log(`Loaded ${this.possibleWords.length} words. Session Seed: ${this.seed}\n`);
        } catch (error) {
            console.error("Error loading dictionary:", error.message);
            process.exit(1);
        }
    }

    /**
     * Sends guess payload using the configured API client.
     */
    async makeGuess(guessWord) {
        try {
            const response = await this.apiClient.get('/random', {
                params: {
                    guess: guessWord,
                    size: 5,
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
     * Optimized single-pass candidate filtering using pre-processed positional rules.
     */
    filterWords(feedback) {
        const charBounds = {};
        const exactPos = new Array(5).fill(null);
        const wrongPos = Array.from({ length: 5 }, () => new Set());

        // 1. Process feedback constraints
        for (const { slot, guess: char, result } of feedback) {
            if (!charBounds[char]) {
                charBounds[char] = { min: 0, max: Infinity };
            }

            if (result === 'correct') {
                exactPos[slot] = char;
                charBounds[char].min += 1;
            } else if (result === 'present') {
                wrongPos[slot].add(char);
                charBounds[char].min += 1;
            } else if (result === 'absent') {
                wrongPos[slot].add(char);
            }
        }

        // Cap upper bounds for absent letters
        for (const { guess: char, result } of feedback) {
            if (result === 'absent') {
                charBounds[char].max = charBounds[char].min;
            }
        }

        // 2. Filter remaining word candidates
        this.possibleWords = this.possibleWords.filter(word => {
            // Positional lookup checks
            for (let i = 0; i < 5; i++) {
                if (exactPos[i] && word[i] !== exactPos[i]) return false;
                if (wrongPos[i].has(word[i])) return false;
            }

            // Character frequency bounds check
            for (const char in charBounds) {
                const { min, max } = charBounds[char];
                let count = 0;
                for (let i = 0; i < 5; i++) {
                    if (word[i] === char) count++;
                }
                if (count < min || count > max) return false;
            }

            return true;
        });
    }

    /**
     * Positional & Unique Frequency Scoring Algorithm.
     * Selects the word from remaining candidates that yields maximum letter discovery.
     */
    getBestGuess() {
        if (this.possibleWords.length <= 2) {
            return this.possibleWords[0];
        }

        const posFreq = Array.from({ length: 5 }, () => ({}));
        const letterFreq = {};

        // Calculate frequency maps across remaining candidate words
        for (const word of this.possibleWords) {
            for (let i = 0; i < 5; i++) {
                const char = word[i];
                posFreq[i][char] = (posFreq[i][char] || 0) + 1;
                letterFreq[char] = (letterFreq[char] || 0) + 1;
            }
        }

        let bestWord = this.possibleWords[0];
        let maxScore = -1;

        // Score words based on letter uniqueness + positional likelihood
        for (const word of this.possibleWords) {
            let score = 0;
            const seenChars = new Set();

            for (let i = 0; i < 5; i++) {
                const char = word[i];
                score += (posFreq[i][char] || 0); // Position match weight

                if (!seenChars.has(char)) {
                    score += (letterFreq[char] || 0) * 1.5; // Unique character discovery weight
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

    /**
     * Main Execution Loop
     */
    async play() {
        await this.loadDictionary();

        let attempts = 0;
        const maxAttempts = 6;

        while (attempts < maxAttempts) {
            attempts++;

            // Use 'salet' as standard opener, otherwise compute maximum entropy guess
            const nextGuess = (attempts === 1 && this.possibleWords.includes("salet"))
                ? "salet"
                : this.getBestGuess();

            if (!nextGuess) {
                console.log("❌ Run out of candidate words. Target word is not in dictionary.");
                return;
            }

            console.log(`Attempt ${attempts}/${maxAttempts}: Guessing "${nextGuess.toUpperCase()}"...`);

            const feedback = await this.makeGuess(nextGuess);
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

// --- Run the Script ---
const API_BASE_URL = 'https://wordle.votee.dev:8000';
const solver = new WordleSolver(API_BASE_URL);

solver.play();
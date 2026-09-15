// solver.js
const axios = require('axios');

const DICTIONARY_URL = 'https://raw.githubusercontent.com/darkermango/5-Letter-words/main/words.txt';

class WordleSolver {
    // Auto-generates a seed if none is provided to lock the target word across turns
    constructor(baseUrl, seed = Math.floor(Math.random() * 1000000)) {
        this.baseUrl = baseUrl;
        this.seed = seed;
        this.possibleWords = []; 
    }

    /**
     * Downloads the dictionary from the web and initializes the word list.
     */
    async loadDictionary() {
        console.log("Downloading 5-letter English dictionary...");
        try {
            const response = await axios.get(DICTIONARY_URL, { responseType: 'text' });
            
            this.possibleWords = response.data
                .split('\n')
                .map(word => word.trim().toLowerCase())
                .filter(word => word.length === 5);

            console.log(`Successfully loaded ${this.possibleWords.length} words.`);
            console.log(`Session Seed: ${this.seed}\n`);
        } catch (error) {
            console.error("Error loading dictionary:", error.message);
            process.exit(1);
        }
    }

    /**
     * Sends a guess to the API and returns the feedback.
     */
    async makeGuess(guessWord) {
        try {
            const response = await axios.get(`${this.baseUrl}/random`, {
                params: {
                    guess: guessWord,
                    size: 5,
                    seed: this.seed // Always send the seed
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
     * Filters candidate words using positional constraints and character frequency constraints.
     */
    filterWords(feedback) {
        const charBounds = {};

        for (const { guess: char } of feedback) {
            if (!charBounds[char]) {
                charBounds[char] = { min: 0, max: Infinity };
            }
        }

        for (const { guess: char, result } of feedback) {
            if (result === 'correct' || result === 'present') {
                charBounds[char].min += 1;
            }
        }

        for (const { guess: char, result } of feedback) {
            if (result === 'absent') {
                charBounds[char].max = charBounds[char].min;
            }
        }

        this.possibleWords = this.possibleWords.filter(word => {
            for (const { slot, guess: char, result } of feedback) {
                if (result === 'correct' && word[slot] !== char) {
                    return false;
                }
                if ((result === 'present' || result === 'absent') && word[slot] === char) {
                    return false;
                }
            }

            for (const char in charBounds) {
                const { min, max } = charBounds[char];

                let count = 0;
                for (let i = 0; i < word.length; i++) {
                    if (word[i] === char) count++;
                }

                if (count < min || count > max) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * The main execution loop
     */
    async play() {
        await this.loadDictionary();

        let attempts = 0;
        const maxAttempts = 6;

        let nextGuess = this.possibleWords.includes("crane") ? "crane" : this.possibleWords[0];

        while (attempts < maxAttempts) {
            attempts++;

            if (!nextGuess) {
                console.log("Uh oh! Run out of candidate words. The target word might not be in the dictionary.");
                return;
            }

            console.log(`Attempt ${attempts}/${maxAttempts}: Guessing "${nextGuess.toUpperCase()}"...`);

            const feedback = await this.makeGuess(nextGuess);
            console.log('feedback', feedback);
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

            nextGuess = this.possibleWords[0];
        }

        console.log("\n❌ Failed to guess the word within the allowed attempts.");
    }
}

// --- Run the Script ---
const API_BASE_URL = 'https://wordle.votee.dev:8000';

// Pass a fixed seed (e.g. 12345) to replay a specific game, or leave blank for a random one
const solver = new WordleSolver(API_BASE_URL);

solver.play();
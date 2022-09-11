// stores/counter.js
import { defineStore } from 'pinia';

export const useGlobalStore = defineStore('global', {
    state: () => {
        return {
            accessToken: ''
        };
    },
    actions: {
        setToken(token) {
            this.accessToken = token;
        },
    },
});
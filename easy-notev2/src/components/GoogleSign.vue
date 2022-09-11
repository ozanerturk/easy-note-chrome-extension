<script setup lang="ts">
import {
    GoogleSignInButton,
    hasGrantedAllScopes,
    type CredentialResponse,
} from "vue3-google-signin";

import { useGlobalStore } from "../store/store";

const globalStore = useGlobalStore();


function parseJwt(token: string) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
};
// handle success event
const handleLoginSuccess = (response: CredentialResponse) => {
    const { credential } = response;
    //decode JWT
    globalStore.setToken(credential);


    console.log(response)
    let parsed = parseJwt(credential!)
    console.log(parsed)

    const result = hasGrantedAllScopes(
        response,
        "https://www.googleapis.com/auth/drive"
    );
    alert(result)
};

// handle an error event
const handleLoginError = () => {
    console.error("Login failed");
};
</script>

<template>
    <GoogleSignInButton @success="handleLoginSuccess" @error="handleLoginError"></GoogleSignInButton>
</template>

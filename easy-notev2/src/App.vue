<script setup lang="ts">
// This starter template is using Vue 3 <script setup> SFCs
// Check out https://vuejs.org/api/sfc-script-setup.html#script-setup
// import GoogleSign from './components/GoogleSign.vue'
import { ref, watch, onMounted } from 'vue';
import { useGlobalStore } from "./store/store";

import { useGsiScript, useOneTap, type CredentialResponse } from "vue3-google-signin";
// load GSI script
const { scriptLoaded, scriptLoadError } = useGsiScript()

useOneTap({
  disableAutomaticPrompt: true,
  onSuccess: (response: CredentialResponse) => {
    console.log("Success:", response);
    localStorage.setItem("token", response.credential as string)
  },
  onError: () => console.error("Error with One Tap Login"),
  // options
});
watch(scriptLoaded, () => {
  console.log("GSI script loaded");
  const client = google.accounts.oauth2.initTokenClient({
    client_id: "1042376880553-pou8brkabbv88k99ajbc4j7afvp2n76v.apps.googleusercontent.com",
    scope:       "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.readonly",
    callback: async (response: any) => {
      console.log(response)
      localStorage.setItem("accessToken", response.access_token)
      let rs = await fetch("https://www.googleapis.com/drive/v3/files", {
        headers: {
          Authorization: `Bearer ${response.access_token}`,
        },
      }).then((res) => res.json());
      console.log(rs)
    },
  });
  console.log(client)
  client.requestAccessToken()

});



// let data = ref()
// let globalStore = useGlobalStore()
// function saveData() {

//   console.log("Saving data", data.value);
//   let token = globalStore.accessToken
//   alert(token)

// }

</script>
<template>
  scriptLoadError:{{scriptLoadError}}<br>
  scriptLoaded:{{scriptLoaded}}<br>
  <!-- </textarea> -->
  <!-- <button @click="saveData">Save</button> -->
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
}

.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}

.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>

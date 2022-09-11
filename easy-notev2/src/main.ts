import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createPinia } from 'pinia'

const pinia = createPinia()

let app = createApp(App)
app.use(pinia)


import GoogleSignInPlugin from "vue3-google-signin"

app.use(GoogleSignInPlugin, {
  clientId: "1042376880553-pou8brkabbv88k99ajbc4j7afvp2n76v.apps.googleusercontent.com",
});


app.mount('#app')

// load GSI script


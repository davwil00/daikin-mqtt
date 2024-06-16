# Daikin MQTT
A small javascript app to connect to the daikin API and fetch informatiom to record to a database and MQTT server.
Ideal for capturing historic information about tank temperatures that can be viewed in e.g. Grafana.

## Reqirements
Running MQTT server
Running Postgresql server
Daikin Developer Account

## To run
Copy .env.example to .env and fill in credentials
Install dependencies
```bash
npm install
```
Start the app
```bash
npm run start
```

## Database config
Run the script `sql/V1_init_tables.sql` to create the table to store the data.

## Onecta Cloud API
You need a Daikin developer account and an app created in order to use this.

Initial auth flow not yet supported, for new usages you'll need to get hold of a code by visiting this url (after replacing the placeholders with the details from your app)
https://idp.onecta.daikineurope.com/v1/oidc/authorize?response_type=code&client_id={{clientId}}&redirect_uri={{redirectUri}}&scope=openid%20onecta:basic.integration

Once you have the code, get a token from
GET https://idp.onecta.daikineurope.com/v1/oidc/token?grant_type=authorization_code&client_id={{clientId}}&client_secret={{clientSecret}}&code={{code}}&redirect_uri={{redirectUrl}}

Save the response to `token.json`

For more info, see the docs
https://developer.cloud.daikineurope.com/docs


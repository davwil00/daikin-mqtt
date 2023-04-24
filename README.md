# Daikin MQTT
A small javascript app to connect to the daikin API and fetch informatiom to record to a database and MQTT server.
Ideal for capturing historic information about tank temperatures that can be viewed in e.g. Grafana.

## Reqirements
Running MQTT server
Running Postgresql server
Daikin Account

## To run
Copy .env.example to .env and fill in credentials
Install dependencies
```bash
npm install
```
Start the app
```bash
node main.js
```

## Database config
Run the script `sql/V1_init_tables.sql` to create the table to store the data.
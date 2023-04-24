const fs = require('fs')
const DaikinCloud = require('daikin-controller-cloud');
const path = require('path');
require('dotenv').config()
const mqtt = require('async-mqtt')
const { Client } = require('pg')

async function initDaikinCloud() {
    /**
    * Options to initialize the DaikinCloud instance with
    */
    const options = {
        logger: console.log,          // optional, logger function used to log details depending on loglevel
        logLevel: 'info',             // optional, Loglevel of Library, default 'warn' (logs nothing by default)
        proxyOwnIp: '192.168.xxx.xxx',// required, if proxy needed: provide own IP or hostname to later access the proxy
        proxyPort: 8888,              // required: use this port for the proxy and point your client device to this port
        proxyWebPort: 8889,           // required: use this port for the proxy web interface to get the certificate and start Link for login
        proxyListenBind: '0.0.0.0',   // optional: set this to bind the proxy to a special IP, default is '0.0.0.0'
        proxyDataDir: __dirname,      // Directory to store certificates and other proxy relevant data to
        communicationTimeout: 10000,  // Amount of ms to wait for request and responses before timeout
        communicationRetries: 3       // Amount of retries when connection timed out
    };

    let tokenSet;

    // Load Tokens if they already exist on disk
    const tokenFile = path.join(__dirname, 'tokenset.json');
    if (fs.existsSync(tokenFile)) {
        tokenSet = JSON.parse(fs.readFileSync(tokenFile).toString());
    }

    const daikinCloud = new DaikinCloud(tokenSet, options);

    // Event that will be triggered on new or updated tokens, save into file
    daikinCloud.on('token_update', tokenSet => {
        console.log(`UPDATED tokens, use for future and wrote to tokenset.json`);
        fs.writeFileSync(tokenFile, JSON.stringify(tokenSet));
    });

    // If no tokens are existing fetch them
    if (! tokenSet) {
        const email = process.env.CONF_EMAIL
        const password = process.env.CONF_PASSWORD
        console.log(`Using provided Login credentials for a direct Login`)
        try {
            await daikinCloud.login(email, password);
        }
        catch (e) {
            console.error('Unable to login')
        }
        console.log('Retrieved tokens. Saved to ' + tokenFile);
    }

    return daikinCloud
}

function initMqtt() {
    return mqtt.connectAsync(process.env.MQTT_URL, {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
    })
}

async function saveToDb(dbClient, outsideTemp, tankTemp) {
    const query = 'INSERT INTO heat_pump(sensor_id, timestamp, temp) VALUES($1, $2, $3);'
    const outsideTempValues = ['outsideTemp', new Date(), outsideTemp]
    const tankTempValues = ['tankTemp', new Date(), tankTemp]

    try {
        await dbClient.query(query, outsideTempValues)
        await dbClient.query(query, tankTempValues)
    } catch (err) {
        console.log(err.stack)
    }
}

async function getData(daikinCloud, mqtt, dbClient) {
    console.log('Fetching data')
    const devices = await daikinCloud.getCloudDevices();

    if (devices && devices.length) {
        const outsideTemp = devices[0].managementPoints.climateControlMainZone.sensoryData['/outdoorTemperature'].value
        const tankTemp = devices[0].managementPoints.domesticHotWaterTank.sensoryData['/tankTemperature'].value
        console.log('Outside temperature:', outsideTemp)
        console.log('Tank temperature:', tankTemp)
        await mqtt.publish('heatpump/outsidetemp', `${outsideTemp}`, {retain: true})
        await mqtt.publish('heatpump/tanktemp', `${tankTemp}`, {retain: true})
        await saveToDb(dbClient, outsideTemp, tankTemp)
    } else {
        console.error('No devices found')
    }
}

async function connectToDb() {
    const client = new Client()
    await client.connect()
    return client
}


fs.rmSync('tokenset.json', {force: true})
Promise.all([connectToDb(), initDaikinCloud(), initMqtt()])
    .then(async ([dbClient, daikinCloud, mqtt]) => {

        while (true) {
            await getData(daikinCloud, mqtt, dbClient)
            await new Promise(r => setTimeout(r, 600000));
        }
    })


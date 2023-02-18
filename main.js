const fs = require('fs')
const DaikinCloud = require('daikin-controller-cloud');
const path = require('path');
require('dotenv').config()
const mqtt = require('async-mqtt')
const { MongoClient } = require("mongodb");

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
        await daikinCloud.login(email, password);
        console.log('Retrieved tokens. Saved to ' + tokenFile);
    }

    return daikinCloud
}

function initMqtt() {
    return mqtt.connectAsync('mqtt://192.168.0.2:1883', {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
    })
}

async function saveToDb(db, outsideTemp, tankTemp) {
    await db.insertMany([
        {
            metadata: {
                sensorId: 'outsideTemp',
                type: 'temperature'
            },
            timestamp: new Date(),
            temp: outsideTemp
        },
        {
            metadata: {
                sensorId: 'tankTemperature',
                type: 'temperature'
            },
            timestamp: new Date(),
            temp: tankTemp
        },
        ])
}

async function getData(daikinCloud, mqtt, db) {
    console.log('Fetching data')
    const devices = await daikinCloud.getCloudDevices();

    if (devices && devices.length) {
        const outsideTemp = devices[0].managementPoints.climateControlMainZone.sensoryData['/outdoorTemperature'].value
        const tankTemp = devices[0].managementPoints.domesticHotWaterTank.sensoryData['/tankTemperature'].value
        console.log('Outside temperature:', outsideTemp)
        console.log('Tank temperature:', tankTemp)
        await mqtt.publish('heatpump/outsidetemp', `${outsideTemp}`)
        await mqtt.publish('heatpump/tanktemp', `${tankTemp}`)
        await saveToDb(db, outsideTemp, tankTemp)
    } else {
        console.error('No devices found')
    }
}

function connectToDb() {
    const uri = `mongodb+srv://mqtt:${process.env.MONGO_PASSWORD}@bingo.oga25.mongodb.net?retryWrites=true&w=majority`
    return new MongoClient(uri);
}

const dbClient = connectToDb()
Promise.all([initDaikinCloud(), initMqtt()])
    .then(async ([daikinCloud, mqtt]) => {
        const database = dbClient.db('mqtt');
        const mqttDb = database.collection('mqtt');

        while (true) {
            await getData(daikinCloud, mqtt, mqttDb)
            await new Promise(r => setTimeout(r, 120000));
        }
    })
    .finally(() => dbClient.close())


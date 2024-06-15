import mqtt from "async-mqtt"
import pkg from "pg"
import {readFileSync, existsSync, writeFile} from "fs"
const {Client} = pkg

function initMqtt() {
    return mqtt.connectAsync(process.env.MQTT_URL, {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
    })
}

async function connectToDb() {
    const client = new Client()
    await client.connect()
    return client
}

async function saveToDb(dbClient, outsideTemp, tankTemp) {
    const query = 'INSERT INTO heat_pump(sensor_id, timestamp, temp) VALUES($1, $2, $3)'
    const outsideTempValues = ['outsideTemp', new Date(), outsideTemp]
    const tankTempValues = ['tankTemp', new Date(), tankTemp]

    try {
        await dbClient.query(query, outsideTempValues)
        await dbClient.query(query, tankTempValues)
    } catch (err) {
        console.log(err.stack)
    }
}

function parseJwt(token) {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
}

async function getAccessToken() {
    if (!existsSync('token.json')) {
        console.error(`No token found, please log in to get a token and try again: https://idp.onecta.daikineurope.com/v1/oidc/authorize?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URL}&scope=openid%20onecta:basic.integration`)
    }
    const accessToken = JSON.parse(readFileSync('token.json', {encoding: 'utf8'})).access_token
    const tokenData = parseJwt(accessToken)
    const expiry = new Date(tokenData.exp * 1000)
    if (expiry < new Date()) {
        // fetch new token
        const response = await fetch(`https://idp.onecta.daikineurope.com/v1/oidc/token?grant_type=authorization_code&client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&code=${tokenData.refresh_token}&redirect_uri=https://oidc.davwil00.co.uk`, {
            method: 'post'
        }).then(response => response.json())
        // update token.json
        await writeFile('token.json', JSON.stringify(response))
        return response.access_token
    } else {
        return accessToken
    }
}

async function getData(daikinCloud, mqtt, dbClient) {
    console.log('Fetching data')
    const token = await getAccessToken()
    const devices = await fetch('https://api.onecta.daikineurope.com/v1/gateway-devices',
        {
            headers: {
                Authorization: `bearer ${token}`
            }
        }).then(response => response.json())

    if (devices) {
        const dhwTank = devices[0].managementPoints.find(managementPoint => managementPoint.embeddedId === 'domesticHotWaterTank')
        const tankTemp = dhwTank.sensoryData.value.tankTemperature.value
        console.log('Tank temperature:', tankTemp)
        const ccMainZone = devices[0].managementPoints.find(managementPoint => managementPoint.embeddedId === 'climateControlMainZone')
        const outsideTemp = ccMainZone.sensoryData.value.outdoorTemperature.value
        console.log('Outside temperature:', outsideTemp)
        await mqtt.publish('heatpump/outsidetemp', `${outsideTemp}`, {retain: true})
        await mqtt.publish('heatpump/tanktemp', `${tankTemp}`, {retain: true})
        await saveToDb(dbClient, outsideTemp, tankTemp)
    } else {
        console.error('No devices found')
    }
}

Promise.all([connectToDb(), initMqtt()])
    .then(async ([dbClient, daikinCloud, mqtt]) => {

        while (true) {
            await getData(daikinCloud, mqtt, dbClient)
            await new Promise(r => setTimeout(r, 600000)) // 10 mins
        }
    })


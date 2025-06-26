const aedes = require('aedes')()
const server = require('net').createServer(aedes.handle)
const port = 1883

listRequest = []
listRoom = []
let isAddingRoom = false

class Room {
    constructor(name, macAddress, buttons = []) {
        this.name = name; 
        this.macAddress = macAddress; 
        this.buttons = buttons; 
    }
}

class Button {
    constructor(name, id) {
        this.name = name; 
        this.id = id; 
    }
}

class Request{
    constructor(id, room, button, status,secondUntilAction, createdAt) {
        this.id = id; 
        this.room = room; 
        this.button = button; 
        this.status = status; 
        this.secondUntilAction = secondUntilAction;
        this.createdAt = createdAt;
    }
}


function isValidMacAddress(mac) {
    const macRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
    return macRegex.test(mac);
}

server.listen(port, function () {
    console.log('Server MQTT is running on port  ', port)
})

// aedes.authenticate = function (client, username, password, callback) {
//     console.log('client', client)
//     callback(null, username === 'quyt' && password.toString() === '123456')
//   }

aedes.on('client', function (client) {
    console.log('client connected', client?.id)
})

aedes.on('subscribe', function (subscriptions , client) {
    console.log('client subscribe', subscriptions)
    if(isValidMacAddress(client?.id)){
        const findMac = client?.id
        const foundRoom = listRoom.find(gw => gw.macAddress === findMac)
        if(foundRoom){
            const buttonId = foundRoom.buttons.map(button => button.id)
            aedes.publish({
                topic: `${client?.id}/check-connect`,
                payload: Buffer.from(JSON.stringify(buttonId))
            })
        }else{
            aedes.publish({
                topic: `${client?.id}/check-connect`,
                payload: Buffer.from('0')
            })
        }
    }
    if(subscriptions[0].topic === 'gw-connect-response'){
        isAddingRoom = true
    }
})


aedes.on('publish', function (publishPacket, client) {
    console.log('client publish', publishPacket.topic, publishPacket.payload.toString())    ;

    if(publishPacket.topic === 'get-room'){
        aedes.publish({
            topic: 'list-room',
            payload: Buffer.from(JSON.stringify(listRoom))
        })
    }else if(publishPacket.topic === 'room-connect'){
        if(!isAddingRoom) return
        const findMac = publishPacket.payload.toString()
        const foundRoom = listRoom.find(gw => gw.macAddress === findMac)
        if(foundRoom){
            aedes.publish({
                topic: 'gw-connect-response',
                payload: Buffer.from('-1')
            })
        }else{
            const room = new Room(`Phòng ${listRoom.length + 1}`, publishPacket.payload.toString())
            listRoom.push(room)
            console.log('listRoom==========================', listRoom);
            aedes.publish({
                topic: 'gw-connect-response',
                payload: Buffer.from(publishPacket.payload.toString())
            })
            aedes.publish({
                topic: `${client?.id}/check-connect`,
                payload: Buffer.from('1')
            })
        }
    }else if(publishPacket.topic.includes('add-button')){
        const findMac = client?.id
        const foundRoom = listRoom.find(gw => gw.macAddress === findMac)
        if(foundRoom){
            const foundButton = foundRoom.buttons.find(button => button.id === publishPacket.payload.toString())
            if(foundButton){
                aedes.publish({
                    topic: 'gw-button-response',
                    payload: Buffer.from('-1')
                })
            }else{
                const button = new Button(`Giường ${foundRoom.buttons.length + 1}`,publishPacket.payload.toString())
                foundRoom.buttons.push(button)
                console.log('listRoom==========================', listRoom);
                aedes.publish({
                    topic: `${client?.id}/gw-button-response`,
                    payload: Buffer.from(JSON.stringify(button))
                })
            }
        }else{
            console.log('Room not found for mac address: ', findMac);
        }
    }else if(publishPacket.topic.includes('new-request')){
        const pendingRequest = listRequest.find(req => req.room.macAddress === client?.id && req.button.id == publishPacket.payload.toString() && req.status === 1)
        if(pendingRequest){
            console.log('Request is pending for room: ', client?.id);
            return
        }
        const findMac = client?.id
        const foundRoom = listRoom.find(gw => gw.macAddress === findMac)
        if(!foundRoom){
            console.log('Room not found for mac address: ', findMac);
            return
        }
        const foundButton = foundRoom.buttons.find(button => button.id === publishPacket.payload.toString())
        if(!foundButton){
            console.log('Button not found for id: ', publishPacket.payload.toString());
            return
        }
        const request = new Request(
            `${Date.now()}`,
            foundRoom,
            foundButton,
            1,
            0,
            new Date().toISOString()
        )
        listRequest.push(request)
        aedes.publish({
            topic: 'requests',
            payload: Buffer.from(JSON.stringify(request))
        })
    }else if(publishPacket.topic === 'get-requests'){
        aedes.publish({
            topic: 'get-requests-response',
            payload: Buffer.from(JSON.stringify(listRequest))
        })
    }else if(publishPacket.topic.includes('update-request')){
        let buff = Buffer.from(publishPacket?.payload);
        let request = null;
        try {
           request = JSON.parse(buff.toString());
        } catch (e) {
          console.log("Parse payload fail", e);
        }
        console.log('update-request', request);
        const foundRequest = listRequest.find(req => req.id === request.id)
        if(!foundRequest){
            console.log('Request not found for id: ', request.id);
            return
        }
        foundRequest.status = request.status
        foundRequest.secondUntilAction = request.secondUntilAction
        aedes.publish({
            topic: `${foundRequest.room.macAddress}/request-updated`,
            payload: Buffer.from("1")
        })
    }else if(publishPacket.topic === 'clear'){
       let findMac = client?.id
       for (let i = listRequest.length - 1; i >= 0; i--) {
           if(listRequest[i].room.macAddress === findMac){
              listRequest[i].status = 0
           }
       }
    }
})

aedes.on('clientDisconnect', function (client) {
    console.log('client disconnected', client?.id)
})




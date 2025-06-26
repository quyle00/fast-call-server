const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);
const fs = require('fs');
const Department = require('./department');
const Room = require('./room');
const Request = require('./request');

const port = 1883;
const ROOMS_FILE = 'data/rooms.json';
const REQUESTS_FILE = 'data/requests.json';
const DEPARTMENTS_FILE = 'data/departments.json';

// Đọc/ghi file JSON
function loadData(file) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error reading file ${file}:`, err);
        return [];
    }
}

function saveData(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`Error writing file ${file}:`, err);
    }
}

// Khởi tạo dữ liệu
let departments = loadData(DEPARTMENTS_FILE).map(dep => {
    const department = new Department(dep.id, dep.account);
    department.rooms = dep.rooms.map(room => {
        const r = new Room(room.macAddress, room.name, room.buttons);
        r.departmentId = dep.id; // Gắn ID khoa cho phòng
        return r;
    });
    return department;
});
let listRequest = loadData(REQUESTS_FILE).map(req => {
    const request = new Request(req.id, req.room, req.button, req.status, req.secondUntilAction, req.createdAt);
    request.logs = req.logs || [{ status: req.status, timestamp: req.createdAt }];
    return request;
});
let listRoom = departments.flatMap(dep => dep.rooms);

let wattingDepartmentId = null;

// Tạo ID mới cho khoa
function getNextDepartmentId() {
    return departments.length > 0 ? Math.max(...departments.map(dep => dep.id)) + 1 : 0;
}

function isValidMacAddress(mac) {
    const macRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
    return macRegex.test(mac);
}

function findRoomByMac(mac) {
    return listRoom.find(room => room.macAddress === mac);
}

function findButtonById(room, buttonId) {
    return room?.buttons.find(button => button.id === buttonId);
}

function findDepartmentById(id) {
    return departments.find(dep => dep.id === parseInt(id));
}

server.listen(port, () => {
    //print current ip
    const interfaces = require('os').networkInterfaces();
    let ipAddress = '';
    for (const interfaceName in interfaces) {
        for (const iface of interfaces[interfaceName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ipAddress = iface.address;
                break;
            }
        }
        if (ipAddress) break;
    }
    console.log(`Server is running on ${ipAddress}:${port}`);
});

aedes.on('client', (client) => {
    console.log('Client connected:', client?.id);
});

aedes.on('subscribe', (subscriptions, client) => {
    console.log('Client subscribe:', subscriptions);
    const topicParts = subscriptions[0].topic.split('/');
    if (topicParts[1] === 'rooms') {
        let departmentId = parseInt(topicParts[0]);
        const department = findDepartmentById(departmentId);
        aedes.publish({
            topic: `${departmentId}/rooms`,
            payload: Buffer.from(JSON.stringify(department?.rooms || []))
        });
    }
    if (topicParts[1] === 'requests') {
        let departmentId = parseInt(topicParts[0]);
        aedes.publish({
            topic: `${departmentId}/requests`,
            payload: Buffer.from(JSON.stringify(listRequest.filter(req => req.room.departmentId === departmentId)))
        });
    }
    if(subscriptions[0].topic.includes('add-room-response')) {
        wattingDepartmentId = parseInt(subscriptions[0].topic.split('/')[0]);
        console.log('Waiting for room addition response for department ID:', wattingDepartmentId);
    }
    if (isValidMacAddress(client?.id)) {
        const foundRoom = findRoomByMac(client?.id);
        if (foundRoom) {
            const buttonIds = foundRoom.buttons.map(button => button.id);
            aedes.publish({
                topic: `${client?.id}/check-connect`,
                payload: Buffer.from(JSON.stringify(buttonIds))
            });
        } else {
            aedes.publish({
                topic: `${client?.id}/check-connect`,
                payload: Buffer.from('0')
            });
        }
    }
});

aedes.on('unsubscribe', (unsubscriptions, client) => {
    console.log('Client unsubscribe:', unsubscriptions);
    if (unsubscriptions && unsubscriptions.length > 0 && unsubscriptions[0].topic?.includes('add-room-response')) {
        wattingDepartmentId = null; 
        console.log('Unsubscribed from add-room-response for department ID:', unsubscriptions[0].topic.split('/')[0]);
    }
});

aedes.on('publish', (publishPacket, client) => {
    console.log('Client publish:', publishPacket.topic);
    const topicParts = publishPacket.topic.split('/');

    // Xử lý đăng nhập
    if (publishPacket.topic === 'login') {
        try {
            const { username, password } = JSON.parse(publishPacket.payload.toString());
            const department = departments.find(dep => dep.account.username === username && dep.account.password === password);
            aedes.publish({
                topic: 'login-response',
                payload: Buffer.from(JSON.stringify({
                    success: !!department,
                    departmentId: department ? department.id : null
                }))
            });
        } catch (err) {
            console.error('Error parsing login payload:', err);
            aedes.publish({
                topic: 'login-response',
                payload: Buffer.from(JSON.stringify({ success: false }))
            });
        }
        return;
    }

    // Xử lý lấy danh sách phòng của khoa
    if (topicParts[1] === 'rooms') {
        let departmentId = parseInt(topicParts[0]);
        const department = findDepartmentById(departmentId);
        aedes.publish({
            topic: `/${departmentId}/rooms`,
            payload: Buffer.from(JSON.stringify(department?.rooms || []))
        });
        return;
    }

    // Xử lý thêm phòng mới
    if (publishPacket.topic === 'add-room') {
        const mac = publishPacket.payload.toString();
        const department = findDepartmentById(wattingDepartmentId);
        if (!department || findRoomByMac(mac)) {
            aedes.publish({
                topic: `/${topicParts[1]}/add-room-response`,
                payload: Buffer.from('-1')
            });
            return;
        }
        const room = new Room(mac, `Phòng ${department.rooms.length + 1}`);
        room.departmentId = department.id;
        department.rooms.push(room);
        listRoom = departments.flatMap(dep => dep.rooms);
        saveData(DEPARTMENTS_FILE, departments);
        aedes.publish({
            topic: `${wattingDepartmentId}/add-room-response`,
            payload: Buffer.from(mac)
        });
        aedes.publish({
            topic: `${client?.id}/check-connect`,
            payload: Buffer.from('1')
        })
        return;
    }

    // Xử lý thêm nút nhấn
    if (publishPacket.topic.includes('button-added')) {
        const foundRoom = findRoomByMac(client?.id);
        if (foundRoom && !findButtonById(foundRoom, publishPacket.payload.toString())) {
            const button = { name: `Giường ${foundRoom.buttons.length + 1}`, id: publishPacket.payload.toString() };
            foundRoom.buttons.push(button);
            saveData(DEPARTMENTS_FILE, departments);
            aedes.publish({
                topic: `${foundRoom.macAddress}/add-button-response`,
                payload: Buffer.from(JSON.stringify(button))
            });
        } else {
            aedes.publish({
                topic: `${foundRoom?.macAddress || 'unknown'}/add-button-response`,
                payload: Buffer.from('-1')
            });
        }
        return;
    }

    // Xử lý yêu cầu mới
    if (publishPacket.topic.includes('new-request')) {
        const foundRoom = findRoomByMac(client?.id);
        if (!foundRoom) {
            console.log('Room not found for mac address:', client?.id);
            return;
        }
        const button = findButtonById(foundRoom, publishPacket.payload.toString());
        if (!button) {
            console.log('Button not found for id:', publishPacket.payload.toString());
            return;
        }
        if (listRequest.find(req => req.room.macAddress === client?.id && req.button.id === button.id && req.status === 1)) {
            console.log('Request is pending for room:', client?.id);
            return;
        }
        const request = new Request(
            Date.now().toString(),
            foundRoom,
            button,
            1,
            0,
            new Date().toISOString()
        );
        listRequest.push(request);
        saveData(REQUESTS_FILE, listRequest);
        let departmentId = foundRoom.departmentId;
        aedes.publish({
            topic: `${departmentId}/requests-notification`,
            payload: Buffer.from(JSON.stringify(request))
        });
        return;
    }

    // Xử lý lấy danh sách yêu cầu
    if (publishPacket.topic === 'get-requests') {
        const departmentsId = topicParts[0];
        aedes.publish({
            topic: `${departmentsId}/get-requests-response`,
            payload: Buffer.from(JSON.stringify(listRequest.filter(req => req.room.departmentId === parseInt(departmentsId))))
        });
        return;
    }

    // Xử lý cập nhật trạng thái yêu cầu
    if (topicParts[1] === 'update-request') {
        let request;
        try {
            request = JSON.parse(publishPacket.payload.toString());
        } catch (err) {
            console.error('Error parsing update-request payload:', err);
            return;
        }
        const foundRequest = listRequest.find(req => req.id === request.id);
        if (foundRequest) {
            console.log('Updating request:', request.id, 'to status:', request.status);
            foundRequest.updateStatus(request.status);
            foundRequest.secondUntilAction = request.secondUntilAction;
            saveData(REQUESTS_FILE, listRequest);
            aedes.publish({
                topic: `${foundRequest.room.macAddress}/request-updated`,
                payload: Buffer.from("1")
            });
        } else {
            console.log('Request not found for id:', request.id);
        }
        return;
    }

    // Xử lý xóa yêu cầu
    if (publishPacket.topic === 'clear') {
        const findMac = client?.id;
        for (let i = listRequest.length - 1; i >= 0; i--) {
            if (listRequest[i].room.macAddress === findMac) {
                listRequest[i].status = 3;
                listRequest[i].logs.push({ status: 3, timestamp: new Date().toISOString() });
            }
        }
        saveData(REQUESTS_FILE, listRequest);
        return;
    }
});

aedes.on('clientDisconnect', (client) => {
    console.log('Client disconnected:', client?.id);
});
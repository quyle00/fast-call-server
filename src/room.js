class Room {
    constructor(macAddress, name = '', buttons = []) {
        this.macAddress = macAddress;
        this.name = name;
        this.buttons = buttons;
    }
}

module.exports = Room;
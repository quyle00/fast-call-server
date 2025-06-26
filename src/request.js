class Request {
    constructor(id, room, button, status, secondUntilAction, createdAt) {
        this.id = id;
        this.room = room;
        this.button = button;
        this.status = status;
        this.secondUntilAction = secondUntilAction;
        this.createdAt = createdAt;
        this.logs = [{ status: status, timestamp: new Date().toISOString() }];
    }

    updateStatus(newStatus) {
        this.status = newStatus;
        this.logs.push({ status: newStatus, timestamp: new Date().toISOString() });
    }
}

module.exports = Request;
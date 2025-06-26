class Department {
    constructor(id, account) {
        this.id = id; // Integer: 0, 1, 2, ...
        this.account = account; // { username, password }
        this.rooms = [];
    }
}

module.exports = Department;
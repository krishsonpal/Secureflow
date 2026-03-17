class APIResponse {
    constructor(statuscode, data, message = "success")
    {
        this.success = statuscode < 400
        this.statuscode = statuscode
        this.message = message
        this.data = data
    }
}

export { APIResponse }
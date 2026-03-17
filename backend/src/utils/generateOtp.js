const generateRandom = () =>{
    return Math.floor(Math.random() * 10)
}


const generateOtp = ()=>{
    let otp = ""
    for(let j = 0;j<4;j++)
    {
        otp += generateRandom()
    }
    return otp
}

export {generateOtp}
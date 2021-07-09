
const advanceTime = async (seconds) => {
    await ethers.provider.send('evm_increaseTime', [parseInt(seconds.toString())]);
    await ethers.provider.send('evm_mine', []);
};

module.exports = {
    advanceTime
};



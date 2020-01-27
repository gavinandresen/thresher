const Thresher = artifacts.require("Thresher")
const TornadoMock = artifacts.require("TornadoMock")

module.exports = function(deployer) {
    return deployer.then(async () => {
        const tornadoMock = await deployer.deploy(TornadoMock)
        const thresher = await deployer.deploy(
            Thresher,
            tornadoMock.address,
        )
    })
};

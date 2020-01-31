const Thresher = artifacts.require("Thresher")

module.exports = function(deployer) {
    return deployer.then(async () => {
        const thresher = await deployer.deploy(
            Thresher,
            web3.utils.toWei('0.1', 'ether'),
            1000000 // Tornado deposits are about 1 million gas
        )
    })
};

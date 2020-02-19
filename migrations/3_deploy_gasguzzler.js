const GasGuzzler = artifacts.require("GasGuzzler");

module.exports = function(deployer) {
  deployer.deploy(GasGuzzler);
};

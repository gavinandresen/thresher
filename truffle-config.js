/**
 * More information about configuration can be found at:
 *
 * truffleframework.com/docs/advanced/configuration
 *
 * Sensitive settings go in the .env file:

INFURA_PROJECT_ID=...sign up at infura.io
INFURA_API_SECRET=...
WALLET_SEED=...12-word seed for a HD wallet

 */

require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  networks: {
    // Default:
    development: {
      host: "localhost",
      port: 9545, // the port 'truffle develop' uses
      network_id: "*",
    },

    ganache: {
        host: "localhost",
        port: 7545,
        network_id: "5777"
    },

    // Rinkeby testnet:
    rinkeby: {
      provider: () => new HDWalletProvider(process.env.WALLET_SEED, `https://rinkeby.infura.io/v3/${process.env.INFURA_PROJECT_ID}`),
      network_id: 4,       // Rinkeby id
      gas: 5500000,        // Ropsten has a lower block limit than mainnet
      confirmations: 2,    // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 200,  // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: true     // Skip dry run before migrations? (default: false for public nets )
    },

    mainnet: {
      provider: () => new HDWalletProvider(process.env.WALLET_SEED, `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`),
      network_id: 1,
      confirmations: 2,    // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 200,  // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: false     // Skip dry run before migrations? (default: false for public nets )
    },
  },

  // So we can:
  // truffle run verify Thresher --network rinkeby
  // ... to get etherscan to show the source code, etc:
  plugins: [
    'truffle-plugin-verify'
  ],
  api_keys: {
    etherscan: process.env.ETHERSCAN_API_KEY
  },

  // Set default mocha options here, use special reporters etc.
  mocha: {
    // timeout: 100000
  },

  // Configure your compilers
  compilers: {
    solc: {
      // version: "0.5.1",    // Fetch exact version from solc-bin (default: truffle's version)
      // docker: true,        // Use "0.5.1" you've installed locally with docker (default: false)
      settings: {          // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: "istanbul"
      }
    }
  }
}

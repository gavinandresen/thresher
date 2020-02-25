#!/usr/bin/env node

/*
 * Utility that subscribes to Thresher contract events on the chain
 * and calls processAll() if a bunch of blocks go by with entries
 * waiting to win/lose.
 *
 */
/*
 * Before running, create a .env configuration file; for example:

BLOCKS_TO_WAIT=3
WALLET_SEED=brother arrow ...
INFURA_PROJECT=abcdef...
TRACE=1

 * ... and send some ETH to the first address associated with the HD wallet WALLET_SEED
 */

const assert = require('assert');
const bip39 = require('bip39');
const BN = require('bn');
const HDKey = require('hdkey')
const Web3 = require('web3');
const { toWei, fromWei } = require('web3-utils');
const yargs = require('yargs');
require('dotenv').config();

let web3;
let accounts;
let thresher;

let entries = []; // Array of { blockNumber, depositor } objects

function addEntry(event) {
    entries.push({blockNumber: event.blockNumber, depositor: event.returnValues.depositor});
}
function removeEntry(event) {
    const i = entries.findIndex( (e) => e.depositor == event.returnValues.depositor );
    if (i != -1 ) {
        entries.splice(i, 1);
    }
}

let processing = false; // True when waiting for processAll() to confirm
let mightNeedToppingUp = false; // True after a Win, when we should check Thresher balance

function processAll() {
    processing = true
    thresher.methods.processAll().send({gas: 500*1000})
        .on('transactionHash', function(hash) {
        })
        .on('confirmation', function(confirmationNumber, receipt) {
            // Allow another processAll when confirmed:
            if (confirmationNumber == 2) {
                processing = false;
            }
        })
        .on('receipt', function(receipt) {
        })
        .on('error', function(error, receipt) {
            console.log("processAll() FAILED: "+error);
            process.exit(1);
        })
}

let keepAlive = 0;

function topUpBalance() {
    const fromAddress = thresher.options.from;
    return Promise.all([ thresher.methods.maxPayout().call(),
                         web3.eth.getBalance(thresher.options.address),
                         web3.eth.getBalance(fromAddress)
                       ])
        .then(function(v) {
            const maxPay = new web3.utils.BN(v[0]);
            const thresherBalance = new web3.utils.BN(v[1]);
            const fromBalance = new web3.utils.BN(v[2]);
            const _gas = new web3.utils.BN(100*1000);
            if (thresherBalance.lt(maxPay)) {
                const minTopUp = new web3.utils.BN(web3.utils.toWei('0.2', 'ether'));
                const topUpAmount = web3.utils.BN.max(maxPay.sub(thresherBalance), minTopUp);
                if (fromBalance.lt(topUpAmount.add(_gas))) {
                    throw new Error(`Unable to top-up contract balance, ${fromAddress} balance: ${web3.utils.fromWei(fromBalance)}`);
                }
                return thresher.methods.increaseBalance().send({from: fromAddress, value: topUpAmount, gas: _gas})
                .then(function() {
                    if (process.env.TRACE) {
                        console.log(`increaseBalance(${web3.utils.fromWei(topUpAmount)} ETH)`);
                    }
                })
            }
        })
}

function newBlock(error, event) {
    if (error) {
        console.log(`Error with new block subscription: ${error}`);
        process.exit(1);
    }
    // Keep the websocket connection alive by
    // sending a getPeerCount every once in a while:
    keepAlive += 1;
    if (keepAlive > 30) {
	keepAlive = 0;
	web3.eth.net.getPeerCount()
	    .then( (n) => (n == 0 || console.log(`WARNING: NO PEERS`)));
    }
    if (processing || event.number === null) {
        return;
    }

    // If topUpBalance() generates a transaction, we need
    // it to resolve before calling processAll() generates another
    // transaction. So:
    let p;
    if (mightNeedToppingUp) {
        mightNeedToppingUp = false;
        p = topUpBalance();
    } else {
        p = Promise.resolve();
    }
    p.then(function() {
        let n = 0;
        for (let e of entries) {
            let waitUntil = e.blockNumber+Number(process.env.BLOCKS_TO_WAIT);
            if (waitUntil <= event.number) {
                n = n+1;
            }
        }
        if (n == 0) {
            return;
        }
        if (process.env.TRACE) {
            console.log(`${n} entries waiting, calling processAll()`);
        }

        processAll();
    })
    .catch(console.log)
}

async function init(argv) {
    web3 = new Web3()

    if (argv.network == 'development') {
        const eventProvider = new Web3.providers.WebsocketProvider('ws://localhost:9545');
        web3.setProvider(eventProvider)
    } else {
        const eventProvider = new Web3.providers.WebsocketProvider(
            `wss://${argv.network}.infura.io/ws/v3/${process.env.INFURA_PROJECT_ID}`);

	eventProvider.on("connect", () => {
	    console.log("*** WebSocket Connected ***")
	})
	eventProvider.on("error", (e) => {
	    console.log("*** WebSocket Error ***")
            process.exit(1);
	})
	eventProvider.on("end", (e) => {
	    console.log("*** WebSocket Ended ***")
            process.exit(1);
	})
	eventProvider.on("close", (e) => {
	    console.log("*** WebSocket Closed ***")
            process.exit(1);
	})
	eventProvider.on("timeout", (e) => {
	    console.log("*** WebSocket Timeout ***")
            process.exit(1);
	})
	eventProvider.on("exit", (e) => {
	    console.log("*** WebSocket Exit ***")
            process.exit(1);
	})
	eventProvider.on("ready", (e) => {
	    //console.log('*** WebSocket Ready ***')
	})

        web3.setProvider(eventProvider)
    }

    // I spent a lot of time trying to get truffle's HDWalletProvider to play nicely
    // with WebsocketProvider, but failed. Instead, derive the first key from the
    // seed phrase:
    const masterPrivateKey = bip39.mnemonicToSeedSync(process.env.WALLET_SEED);
    const hdfirst = HDKey.fromMasterSeed(masterPrivateKey).derive("m/44'/60'/0'/0/0");
    // ... and tell web3 to use it to do stuff:
    const account = web3.eth.accounts.privateKeyToAccount('0x' + hdfirst.privateKey.toString('hex'));
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;
    // TODO: Looks like the next version of truffle might Do the Right Thing:
    //       https://github.com/trufflesuite/truffle/pull/2582
    // ... which might let us specify the websocket provider in truffle-config.js,
    // require truffle-config.js in this file and use the same provider for both
    // truffle and this utility.

    const balance = new web3.utils.BN(await web3.eth.getBalance(account.address));
    if (balance.lt(new web3.utils.BN(toWei('0.01', 'ether')))) {
        console.log(`${account.address} balance ${web3.utils.fromWei(balance)}; send it at least 0.01 ETH`)
        process.exit(1);
    }
    console.log(`Sending transactions (paying gas) from ${account.address} (balance: ${web3.utils.fromWei(balance)} ETH)`);

    const contractJson = require('./build/contracts/Thresher.json');

    const netId = await web3.eth.net.getId();
    if (contractJson.networks[netId]) {
        const tx = await web3.eth.getTransaction(contractJson.networks[netId].transactionHash);
        thresher = new web3.eth.Contract(contractJson.abi, contractJson.networks[netId].address);
        thresher.options.from = account.address;
    } else if (argv.thresherAddress) {
        thresher = new web3.eth.Contract(contractJson.abi, argv.thresherAddress);
        thresher.options.from = account.address;
    } else {
        console.log("Don't know where the contract is deployed on this network");
        process.exit(1);
    }
    let currentBlock = await web3.eth.getBlockNumber();
    let b = (currentBlock > 256 ? currentBlock-256 : 1);

    thresher.events.Contribute({
        fromBlock: b,
        toBlock: 'latest'
    })
    .on('data', addEntry)
    .on('changed', removeEntry)

    thresher.events.Win({
        fromBlock: b,
        toBlock: 'latest'
    })
    .on('data', (event) => { removeEntry(event); mightNeedToppingUp = true;})
    .on('changed', addEntry)
    thresher.events.Lose({
        fromBlock: b,
        toBlock: 'latest'
    })
    .on('data', removeEntry)
    .on('changed', addEntry)
    thresher.events.TransferError({
        fromBlock: b,
        toBlock: 'latest'
    })
    .on('data', removeEntry)
    .on('changed', addEntry)

    web3.eth.subscribe('newBlockHeaders', newBlock);
}

const argv = yargs
      .option('network', {
          default: 'development',
          describe: 'a network defined in truffle-config.js',
          type: 'string',
      })
      .option('thresherAddress', {
          default: null,
          describe: 'Address of Thresher contract',
          type: 'string',
      })
      .help()
      .alias('help', 'h')
      .argv;

init(argv);

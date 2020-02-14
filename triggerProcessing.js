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
const BN = require('bn');
const Web3 = require('web3');
const { toWei, fromWei } = require('web3-utils');
const yargs = require('yargs');
const config = require('./truffle-config.js');

let web3;
let accounts;
let thresher;

let entriesWaiting = 0;
let lastContributeBlock = 0;

function addEntry(event) {
    entriesWaiting = entriesWaiting + 1;
    lastContributeBlock = event.blockNumber;
}
function removeEntry(event) {
    entriesWaiting = entriesWaiting - 1;
    if (entriesWaiting < 0) {
        console.log("ERROR: Entries waiting : "+entriesWaiting);
        entriesWaiting = 0;
    }
}

async function init(argv) {
    if (!(argv.network in config.networks)) {
        console.log(`No network ${argv.network} in truffle-config.json`);
        process.exit(1);
    }
    web3 = new Web3()
    if ('provider' in config.networks[argv.network]) {
        web3.setProvider(config.networks[argv.network]['provider']())
    } else {
        const host = config.networks[argv.network]['host'];
        const port = config.networks[argv.network]['port'];
        const eventProvider = new Web3.providers.WebsocketProvider(`ws://${host}:${port}`);
        web3.setProvider(eventProvider)
    }
    const accountAddress = (await web3.eth.getAccounts())[0];

    const balance = new web3.utils.BN(await web3.eth.getBalance(accountAddress));
    if (balance.lt(new web3.utils.BN(toWei('0.01', 'ether')))) {
        console.log(`${accountAddress} balance ${balance}; send it at least 0.01 ETH`)
        process.exit(1);
    }
    console.log(`Sending transcations (paying gas) from ${accountAddress} (balance: ${balance})`);

    let contractJson = require('./build/contracts/Thresher.json');

    let netId = await web3.eth.net.getId();
    if (contractJson.networks[netId]) {
        const tx = await web3.eth.getTransaction(contractJson.networks[netId].transactionHash);
        thresher = new web3.eth.Contract(contractJson.abi, contractJson.networks[netId].address);
        thresher.deployedBlock = tx.blockNumber;
        thresher.options.from = accountAddress;
    } else {
        console.log("Don't know where the contract is deployed on this network");
        process.exit(1);
    }

    thresher.events.Contribute({
        fromBlock: thresher.deployedBlock
    })
    .on('data', addEntry)
    .on('changed', removeEntry)

    thresher.events.Win({
        fromBlock: thresher.deployedBlock
    })
    .on('data', removeEntry)
    .on('changed', addEntry)
    thresher.events.Lose({
        fromBlock: thresher.deployedBlock
    })
    .on('data', removeEntry)
    .on('changed', addEntry)
    thresher.events.TransferError({
        fromBlock: thresher.deployedBlock
    })
    .on('data', removeEntry)
    .on('changed', addEntry)
}

async function processAll() {
    if (entriesWaiting == 0) {
        return;
    }
    let currentBlock = await web3.eth.getBlockNumber();

    let blockGap = currentBlock-lastContributeBlock;
    if (blockGap >= process.env.BLOCKS_TO_WAIT) {
        if (process.env.TRACE) {
            console.log(`${ entriesWaiting } entries waited ${blockGap} blocks, calling processAll()`);
        }

        let g = await thresher.methods.processAll().estimateGas();
        await thresher.methods.processAll().send({gas: g});
    }
}

const argv = yargs
      .option('network', {
          default: 'development',
          describe: 'a network defined in truffle-config.js',
          type: 'string',
      })
      .help()
      .alias('help', 'h')
      .argv;

init(argv);

let looper = setInterval(processAll, 10*1000);
looper.ref();  /* Referencing the timer makes node.js loop forever */

#!/usr/bin/env node

/*
 * Utility that subscribes to Thresher contract events on the chain
 * and calls processAll() if a bunch of blocks go by with entries
 * waiting to win/lose.
 */

const assert = require('assert')
const Web3 = require('web3')
const { toWei, fromWei } = require('web3-utils')

/* How long to wait before calling Thresher.processAll */
let BLOCKS_TO_WAIT = 3

let web3
let thresher

let entriesWaiting = 0
let lastContributeBlock = 0

function addEntry(event) {
    entriesWaiting = entriesWaiting + 1
    lastContributeBlock = event.blockNumber
}
function removeEntry(event) {
    entriesWaiting = entriesWaiting - 1
    if (entriesWaiting < 0) {
        console.log("ERROR: Entries waiting : "+entriesWaiting)
        entriesWaiting = 0
    }
}

async function init() {
    web3 = new Web3('ws://localhost:9545', null, { transactionConfirmationBlocks: 1 })
    let contractJson = require('./build/contracts/Thresher.json')

    let netId = await web3.eth.net.getId()
    if (contractJson.networks[netId]) {
        const tx = await web3.eth.getTransaction(contractJson.networks[netId].transactionHash)
        thresher = new web3.eth.Contract(contractJson.abi, contractJson.networks[netId].address)
        thresher.deployedBlock = tx.blockNumber
        thresher.options.from = (await web3.eth.getAccounts())[0]
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
        return
    }
    let currentBlock = await web3.eth.getBlockNumber();

    if (currentBlock-lastContributeBlock >= BLOCKS_TO_WAIT) {
        let g = await thresher.methods.processAll().estimateGas();

        await thresher.methods.processAll().send({gas: g});
    }
}

init()

let looper = setInterval(processAll, 10*1000)
looper.ref()  /* Referencing the timer makes node.js loop forever */


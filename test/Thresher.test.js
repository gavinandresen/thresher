require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()

const { toBN, randomHex } = require('web3-utils')
const Thresher = artifacts.require('./Thresher.sol')

contract('Thresher', accounts => {
    let thresher
    let sender = accounts[1]

    before(async () => {
        thresher = await Thresher.deployed()
    })

    describe('#deposit', () => {
        it('should throw if deposit too large', async () => {
            const commitment = "0x01"
            let value = web3.utils.toWei('0.11', 'ether')
            const error = await thresher.deposit(commitment, { value, from: sender}).should.be.rejected
            error.reason.should.be.equal('Deposit amount too large')
        })
    })
})

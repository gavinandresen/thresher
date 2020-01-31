require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()

const { toBN, randomHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')
const Thresher = artifacts.require('./Thresher.sol')

contract('Thresher', accounts => {
    let thresher
    let sender = accounts[1]
    let snapshotId
    let tornadoDepositETH  // Cost of tornado deposit in ETH
    let payoutThreshold
    let oneGWEI = web3.utils.toBN(web3.utils.toWei('1', 'gwei'))

    before(async () => {
        thresher = await Thresher.deployed()
        let tornadoDepositGas = await thresher.tornadoDepositGas()
        tornadoDepositETH = tornadoDepositGas.mul(oneGWEI)
        payoutThreshold = web3.utils.toBN(await thresher.payoutThreshold())

        snapshotId = await takeSnapshot() 
    })

    describe('#deposit', () => {
        it('should handle 0-value deposits', async () => {
            let value = web3.utils.toWei('0.0', 'ether')
            let r = await thresher.deposit({value, from: sender, gasPrice: oneGWEI}).should.be.fulfilled
        })
        it('should handle max-value deposits', async () => {
            let value = payoutThreshold.add(tornadoDepositETH)
            let r = await thresher.deposit({value, from: sender, gasPrice: oneGWEI}).should.be.fulfilled
        })
        it('should throw if deposit too large', async () => {
            let value = payoutThreshold.add(tornadoDepositETH).add(web3.utils.toBN(1))
            const error = await thresher.deposit({value, from: sender, gasPrice: oneGWEI}).should.be.rejected
            error.reason.should.be.equal('Deposit amount too large')
        })
        it('should win/lose at random', async () => {
            let winCount = 0
            let loseCount = 0
            let value = payoutThreshold.add(tornadoDepositETH).div(web3.utils.toBN(2))
            for (var i = 0; i < 34; i++) {
                let r = await thresher.deposit({value, from: sender, gasPrice: oneGWEI}).should.be.fulfilled
                for (var n = 0; n < r.logs.length; n++) {
                    if (r.logs[n].event == 'Win') {
                        winCount += 1
                    }
                    if (r.logs[n].event == 'Lose') {
                        loseCount += 1
                    }
                }
            }
            // 32 of the 34 deposits should have been decided at this point
            // The chances of all of them winning or losing are 2^32-- one
            // in four billion. It COULD happen...
            assert(winCount > 0, 'no wins')
            assert(loseCount > 0, 'no losses')
            console.log('Win: ', winCount)
            console.log('Lose: ', loseCount)
        })
    })

    afterEach(async () => {
        // Revert blockchain state between tests:
        await revertSnapshot(snapshotId.result)
        // eslint-disable-next-line require-atomic-updates
        snapshotId = await takeSnapshot()
    })
})

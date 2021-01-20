import { ethers, waffle } from 'hardhat'
import { OracleTest } from '../typechain/OracleTest'
import checkObservationEquals from './shared/checkObservationEquals'
import { expect } from './shared/expect'
import { TEST_PAIR_START_TIME } from './shared/fixtures'
import snapshotGasCost from './shared/snapshotGasCost'

describe('Oracle', () => {
  const [wallet, other] = waffle.provider.getWallets()

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>
  before('create fixture loader', async () => {
    loadFixture = waffle.createFixtureLoader([wallet, other])
  })

  const oracleFixture = async () => {
    const oracleTestFactory = await ethers.getContractFactory('OracleTest')
    return (await oracleTestFactory.deploy()) as OracleTest
  }

  const initializedOracleFixture = async () => {
    const oracle = await oracleFixture()
    await oracle.initialize({
      time: 0,
      tick: 0,
      liquidity: 0,
    })
    return oracle
  }

  describe('#initialize', () => {
    let oracle: OracleTest
    beforeEach('deploy test oracle', async () => {
      oracle = await loadFixture(oracleFixture)
    })
    it('index is 0', async () => {
      await oracle.initialize({ liquidity: 1, tick: 1, time: 1 })
      expect(await oracle.index()).to.eq(0)
    })
    it('cardinality is 1', async () => {
      await oracle.initialize({ liquidity: 1, tick: 1, time: 1 })
      expect(await oracle.cardinality()).to.eq(1)
    })
    it('target is 1', async () => {
      await oracle.initialize({ liquidity: 1, tick: 1, time: 1 })
      expect(await oracle.target()).to.eq(1)
    })
    it('sets first slot timestamp only', async () => {
      await oracle.initialize({ liquidity: 1, tick: 1, time: 1 })
      checkObservationEquals(await oracle.observations(0), {
        initialized: true,
        blockTimestamp: 1,
        tickCumulative: 0,
        liquidityCumulative: 0,
      })
    })
    it('gas', async () => {
      await snapshotGasCost(oracle.initialize({ liquidity: 1, tick: 1, time: 1 }))
    })
  })

  describe('#grow', () => {
    let oracle: OracleTest
    beforeEach('deploy initialized test oracle', async () => {
      oracle = await loadFixture(initializedOracleFixture)
    })

    it('increases the cardinality and target for the first call', async () => {
      await oracle.grow(5)
      expect(await oracle.index()).to.eq(0)
      expect(await oracle.cardinality()).to.eq(5)
      expect(await oracle.target()).to.eq(5)
    })

    it('does not touch the first slot', async () => {
      await oracle.grow(5)
      checkObservationEquals(await oracle.observations(0), {
        liquidityCumulative: 0,
        tickCumulative: 0,
        blockTimestamp: 0,
        initialized: true,
      })
    })

    it('adds data to all the slots', async () => {
      await oracle.grow(5)
      for (let i = 1; i < 5; i++) {
        checkObservationEquals(await oracle.observations(i), {
          liquidityCumulative: 0,
          tickCumulative: 0,
          blockTimestamp: 1,
          initialized: false,
        })
      }
    })

    it('does not change the target when index != cardinality - 1', async () => {
      await oracle.grow(2)
      await oracle.grow(5)
      expect(await oracle.cardinality()).to.eq(2)
      expect(await oracle.target()).to.eq(5)
    })

    it('grow after wrap', async () => {
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 2, liquidity: 1, tick: 1 }) // index is now 1
      await oracle.update({ advanceTimeBy: 2, liquidity: 1, tick: 1 }) // index is now 0 again
      expect(await oracle.index()).to.eq(0)
      await oracle.grow(3)
      expect(await oracle.index()).to.eq(0)
      expect(await oracle.cardinality()).to.eq(2)
      expect(await oracle.target()).to.eq(3)
    })

    it('gas for growing by 1 slot when index == cardinality - 1', async () => {
      await snapshotGasCost(oracle.grow(2))
    })

    it('gas for growing by 10 slots when index == cardinality - 1', async () => {
      await snapshotGasCost(oracle.grow(11))
    })

    it('gas for growing by 1 slot when index != cardinality - 1', async () => {
      await oracle.grow(2)
      await snapshotGasCost(oracle.grow(3))
    })

    it('gas for growing by 10 slots when index != cardinality - 1', async () => {
      await oracle.grow(2)
      await snapshotGasCost(oracle.grow(12))
    })
  })

  describe('#write', () => {
    let oracle: OracleTest

    beforeEach('deploy initialized test oracle', async () => {
      oracle = await loadFixture(initializedOracleFixture)
    })

    it('single element array gets overwritten', async () => {
      await oracle.update({ advanceTimeBy: 1, tick: 2, liquidity: 5 })
      expect(await oracle.index()).to.eq(0)
      checkObservationEquals(await oracle.observations(0), {
        initialized: true,
        liquidityCumulative: 0,
        tickCumulative: 0,
        blockTimestamp: 1,
      })
      await oracle.update({ advanceTimeBy: 5, tick: -1, liquidity: 8 })
      expect(await oracle.index()).to.eq(0)
      checkObservationEquals(await oracle.observations(0), {
        initialized: true,
        liquidityCumulative: 25,
        tickCumulative: 10,
        blockTimestamp: 6,
      })
      await oracle.update({ advanceTimeBy: 3, tick: 2, liquidity: 3 })
      expect(await oracle.index()).to.eq(0)
      checkObservationEquals(await oracle.observations(0), {
        initialized: true,
        liquidityCumulative: 49,
        tickCumulative: 7,
        blockTimestamp: 9,
      })
    })

    it('does nothing if time has not changed', async () => {
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 1, tick: 3, liquidity: 2 })
      expect(await oracle.index()).to.eq(1)
      await oracle.update({ advanceTimeBy: 0, tick: -5, liquidity: 9 })
      expect(await oracle.index()).to.eq(1)
    })

    it('writes an index if time has changed', async () => {
      await oracle.grow(3)
      await oracle.update({ advanceTimeBy: 6, tick: 3, liquidity: 2 })
      expect(await oracle.index()).to.eq(1)
      await oracle.update({ advanceTimeBy: 4, tick: -5, liquidity: 9 })

      expect(await oracle.index()).to.eq(2)
      checkObservationEquals(await oracle.observations(1), {
        tickCumulative: 0,
        liquidityCumulative: 0,
        initialized: true,
        blockTimestamp: 6,
      })
    })

    it('grows cardinality when writing past', async () => {
      await oracle.grow(2)
      await oracle.grow(4)
      expect(await oracle.cardinality()).to.eq(2)
      await oracle.update({ advanceTimeBy: 3, tick: 5, liquidity: 6 })
      expect(await oracle.cardinality()).to.eq(2)
      await oracle.update({ advanceTimeBy: 4, tick: 6, liquidity: 4 })
      expect(await oracle.cardinality()).to.eq(4)
      expect(await oracle.index()).to.eq(2)
      checkObservationEquals(await oracle.observations(2), {
        liquidityCumulative: 24,
        tickCumulative: 20,
        initialized: true,
        blockTimestamp: 7,
      })
    })

    it('wraps around', async () => {
      await oracle.grow(3)
      await oracle.update({ advanceTimeBy: 3, tick: 1, liquidity: 2 })
      await oracle.update({ advanceTimeBy: 4, tick: 2, liquidity: 3 })
      await oracle.update({ advanceTimeBy: 5, tick: 3, liquidity: 4 })

      expect(await oracle.index()).to.eq(0)

      checkObservationEquals(await oracle.observations(0), {
        liquidityCumulative: 23,
        tickCumulative: 14,
        initialized: true,
        blockTimestamp: 12,
      })
    })

    it('accumulates liquidity', async () => {
      await oracle.grow(4)

      await oracle.update({ advanceTimeBy: 3, tick: 3, liquidity: 2 })
      await oracle.update({ advanceTimeBy: 4, tick: -7, liquidity: 6 })
      await oracle.update({ advanceTimeBy: 5, tick: -2, liquidity: 4 })

      expect(await oracle.index()).to.eq(3)

      checkObservationEquals(await oracle.observations(1), {
        initialized: true,
        tickCumulative: 0,
        liquidityCumulative: 0,
        blockTimestamp: 3,
      })
      checkObservationEquals(await oracle.observations(2), {
        initialized: true,
        tickCumulative: 12,
        liquidityCumulative: 8,
        blockTimestamp: 7,
      })
      checkObservationEquals(await oracle.observations(3), {
        initialized: true,
        tickCumulative: -23,
        liquidityCumulative: 38,
        blockTimestamp: 12,
      })
      checkObservationEquals(await oracle.observations(4), {
        initialized: false,
        tickCumulative: 0,
        liquidityCumulative: 0,
        blockTimestamp: 0,
      })
    })
  })

  describe('#scry', () => {
    let oracle: OracleTest
    beforeEach('deploy test oracle', async () => {
      oracle = await loadFixture(oracleFixture)
    })

    it('fails before initialize', async () => {
      await expect(oracle.scry(0)).to.be.revertedWith('')
    })

    it('fails if an older observation does not exist', async () => {
      await oracle.initialize({ liquidity: 4, tick: 2, time: 5 })
      await expect(oracle.scry(1)).to.be.revertedWith('OLD')
    })

    it('single observation at current time', async () => {
      await oracle.initialize({ liquidity: 4, tick: 2, time: 5 })
      const { tickCumulative, liquidityCumulative } = await oracle.scry(0)
      expect(tickCumulative).to.eq(0)
      expect(liquidityCumulative).to.eq(0)
    })

    it('single observation in past but not earlier than secondsAgo', async () => {
      await oracle.initialize({ liquidity: 4, tick: 2, time: 5 })
      await oracle.advanceTime(3)
      await expect(oracle.scry(4)).to.be.revertedWith('OLD')
    })

    it('single observation in past at exactly seconds ago', async () => {
      await oracle.initialize({ liquidity: 4, tick: 2, time: 5 })
      await oracle.advanceTime(3)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(3)
      expect(tickCumulative).to.eq(0)
      expect(liquidityCumulative).to.eq(0)
    })

    it('single observation in past counterfactual in past', async () => {
      await oracle.initialize({ liquidity: 4, tick: 2, time: 5 })
      await oracle.advanceTime(3)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(1)
      expect(tickCumulative).to.eq(4)
      expect(liquidityCumulative).to.eq(8)
    })

    it('single observation in past counterfactual now', async () => {
      await oracle.initialize({ liquidity: 4, tick: 2, time: 5 })
      await oracle.advanceTime(3)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(0)
      expect(tickCumulative).to.eq(6)
      expect(liquidityCumulative).to.eq(12)
    })

    it('two observations in chronological order 0 seconds ago exact', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      const { tickCumulative, liquidityCumulative } = await oracle.scry(0)
      expect(tickCumulative).to.eq(-20)
      expect(liquidityCumulative).to.eq(20)
    })

    it('two observations in chronological order 0 seconds ago counterfactual', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      await oracle.advanceTime(7)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(0)
      expect(tickCumulative).to.eq(-13)
      expect(liquidityCumulative).to.eq(34)
    })

    it('two observations in chronological order seconds ago is exactly on first observation', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      await oracle.advanceTime(7)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(11)
      expect(tickCumulative).to.eq(0)
      expect(liquidityCumulative).to.eq(0)
    })

    it('two observations in chronological order seconds ago is between first and second', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      await oracle.advanceTime(7)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(9)
      expect(tickCumulative).to.eq(-10)
      expect(liquidityCumulative).to.eq(10)
    })

    it('two observations in reverse order 0 seconds ago exact', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      await oracle.update({ advanceTimeBy: 3, tick: -5, liquidity: 4 })
      const { tickCumulative, liquidityCumulative } = await oracle.scry(0)
      expect(tickCumulative).to.eq(-17)
      expect(liquidityCumulative).to.eq(26)
    })

    it('two observations in reverse order 0 seconds ago counterfactual', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      await oracle.update({ advanceTimeBy: 3, tick: -5, liquidity: 4 })
      await oracle.advanceTime(7)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(0)
      expect(tickCumulative).to.eq(-52)
      expect(liquidityCumulative).to.eq(54)
    })

    it('two observations in reverse order seconds ago is exactly on first observation', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      await oracle.update({ advanceTimeBy: 3, tick: -5, liquidity: 4 })
      await oracle.advanceTime(7)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(10)
      expect(tickCumulative).to.eq(-20)
      expect(liquidityCumulative).to.eq(20)
    })

    it('two observations in reverse order seconds ago is between first and second', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.grow(2)
      await oracle.update({ advanceTimeBy: 4, tick: 1, liquidity: 2 })
      await oracle.update({ advanceTimeBy: 3, tick: -5, liquidity: 4 })
      await oracle.advanceTime(7)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(9)
      expect(tickCumulative).to.eq(-19)
      expect(liquidityCumulative).to.eq(22)
    })

    it('gas for single observation at current time', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await snapshotGasCost(oracle.getGasCostOfScry(0))
    })

    it('gas for single observation at current time counterfactually computed', async () => {
      await oracle.initialize({ liquidity: 5, tick: -5, time: 5 })
      await oracle.advanceTime(5)
      await snapshotGasCost(oracle.getGasCostOfScry(0))
    })
  })

  describe.only('full oracle', function () {
    this.timeout(1_200_000)

    let oracle: OracleTest

    const BATCH_SIZE = 300

    const STARTING_TIME = TEST_PAIR_START_TIME

    const maxedOutOracleFixture = async () => {
      const oracle = await oracleFixture()
      await oracle.initialize({ liquidity: 0, tick: 0, time: STARTING_TIME })
      let cardinality = await oracle.cardinality()
      while (cardinality < 65535) {
        const cardinalityNext = Math.min(65535, cardinality + BATCH_SIZE)
        console.log('growing from', cardinality, 'to', cardinalityNext)
        await oracle.grow(cardinalityNext)
        cardinality = cardinalityNext
      }

      for (let i = 0; i < 65535; i += BATCH_SIZE) {
        console.log('batch update starting at', i)
        const batch = Array(BATCH_SIZE)
          .fill(null)
          .map((_, j) => ({
            advanceTimeBy: 13,
            tick: -i - j,
            liquidity: i + j,
          }))
        await oracle.batchUpdate(batch)
      }

      return oracle
    }

    beforeEach('create a full oracle', async () => {
      oracle = await loadFixture(maxedOutOracleFixture)
    })

    it('has max target', async () => {
      expect(await oracle.target()).to.eq(65535)
    })

    it('has max cardinality', async () => {
      expect(await oracle.cardinality()).to.eq(65535)
    })

    it('index wrapped around', async () => {
      expect(await oracle.index()).to.eq(165)
    })

    it('can scry into the ordered portion with exact seconds ago', async () => {
      const { tickCumulative, liquidityCumulative } = await oracle.scry(100 * 13)
      expect(tickCumulative).to.eq(2)
      expect(liquidityCumulative).to.eq(2)
    })

    it('can scry into the ordered portion with unexact seconds ago', async () => {
      const { tickCumulative, liquidityCumulative } = await oracle.scry(100 * 13 + 5)
      expect(tickCumulative).to.eq(2)
      expect(liquidityCumulative).to.eq(2)
    })

    it('can scry after the latest observation counterfactual', async () => {
      await oracle.advanceTime(5)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(3)
      expect(tickCumulative).to.eq(2)
      expect(liquidityCumulative).to.eq(2)
    })

    it('can scry into the unordered portion of array at exact seconds ago of observation', async () => {
      const { tickCumulative, liquidityCumulative } = await oracle.scry(200 * 13)
      expect(tickCumulative).to.eq(2)
      expect(liquidityCumulative).to.eq(2)
    })

    it('can scry into the unordered portion of array at seconds ago between observations', async () => {
      const { tickCumulative, liquidityCumulative } = await oracle.scry(200 * 13 + 5)
      expect(tickCumulative).to.eq(2)
      expect(liquidityCumulative).to.eq(2)
    })

    it('can scry the oldest observation 13*65534 seconds ago', async () => {
      const { tickCumulative, liquidityCumulative } = await oracle.scry(13 * 65534)
      expect(tickCumulative).to.eq(5)
      expect(liquidityCumulative).to.eq(15)
    })

    it('can scry the oldest observation 13*65534 + 5 seconds ago if time has elapsed', async () => {
      await oracle.advanceTime(5)
      const { tickCumulative, liquidityCumulative } = await oracle.scry(13 * 65534 + 5)
      expect(tickCumulative).to.eq(5)
      expect(liquidityCumulative).to.eq(15)
    })
  })
})

import { ethers, waffle } from 'hardhat'
import { Wallet } from 'ethers'
import { MockTimeUniswapV3Pool } from '../typechain/MockTimeUniswapV3Pool'
import { expect } from './shared/expect'

import { poolFixture } from './shared/fixtures'
import snapshotGasCost from './shared/snapshotGasCost'

import {
  expandTo18Decimals,
  FeeAmount,
  getMinTick,
  encodePriceSqrt,
  TICK_SPACINGS,
  createPoolFunctions,
  SwapFunction,
  MintFunction,
  getMaxTick,
  MaxUint128,
  SwapToPriceFunction,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
} from './shared/utilities'

const createFixtureLoader = waffle.createFixtureLoader

describe('UniswapV3Pool gas tests', () => {
  let wallet: Wallet, other: Wallet

  let loadFixture: ReturnType<typeof createFixtureLoader>

  before('create fixture loader', async () => {
    ;[wallet, other] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet, other])
  })

  for (const feeProtocol of [0, 6]) {
    describe(feeProtocol > 0 ? 'fee is on' : 'fee is off', () => {
      const startingPrice = encodePriceSqrt(100001, 100000)
      const startingTick = 0
      const feeAmount = FeeAmount.MEDIUM
      const tickSpacing = TICK_SPACINGS[feeAmount]
      const minTick = getMinTick(tickSpacing)
      const maxTick = getMaxTick(tickSpacing)

      const gasTestFixture = async ([wallet]: Wallet[]) => {
        const fix = await poolFixture([wallet], waffle.provider)

        const pool = await fix.createPool(feeAmount, tickSpacing)

        const { swapExact0For1, swapToHigherPrice, mint, swapToLowerPrice } = await createPoolFunctions({
          swapTarget: fix.swapTargetCallee,
          token0: fix.token0,
          token1: fix.token1,
          pool,
        })

        await pool.initialize(encodePriceSqrt(1, 1))
        await pool.setFeeProtocol(feeProtocol, feeProtocol)
        await pool.increaseObservationCardinalityNext(4)
        await pool.advanceTime(1)
        await mint(wallet.address, minTick, maxTick, expandTo18Decimals(2))

        await swapExact0For1(expandTo18Decimals(1), wallet.address)
        await pool.advanceTime(1)
        await swapToHigherPrice(startingPrice, wallet.address)
        await pool.advanceTime(1)
        expect((await pool.slot0()).tick).to.eq(startingTick)
        expect((await pool.slot0()).sqrtPriceX96).to.eq(startingPrice)

        return { pool, swapExact0For1, mint, swapToHigherPrice, swapToLowerPrice }
      }

      let swapExact0For1: SwapFunction
      let swapToHigherPrice: SwapToPriceFunction
      let swapToLowerPrice: SwapToPriceFunction
      let pool: MockTimeUniswapV3Pool
      let mint: MintFunction

      beforeEach('load the fixture', async () => {
        ;({ swapExact0For1, pool, mint, swapToHigherPrice, swapToLowerPrice } = await loadFixture(gasTestFixture))
      })

      describe('#swapExact0For1', () => {
        xit('first swap in block with no tick movement', async () => {
          await snapshotGasCost(swapExact0For1(2000, wallet.address))
          expect((await pool.slot0()).sqrtPriceX96).to.not.eq(startingPrice)
          expect((await pool.slot0()).tick).to.eq(startingTick)
        })

        xit('first swap in block moves tick, no initialized crossings', async () => {
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1).div(10000), wallet.address))
          expect((await pool.slot0()).tick).to.eq(startingTick - 1)
        })

        xit('second swap in block with no tick movement', async () => {
          await swapExact0For1(expandTo18Decimals(1).div(10000), wallet.address)
          expect((await pool.slot0()).tick).to.eq(startingTick - 1)
          await snapshotGasCost(swapExact0For1(2000, wallet.address))
          expect((await pool.slot0()).tick).to.eq(startingTick - 1)
        })

        xit('second swap in block moves tick, no initialized crossings', async () => {
          await swapExact0For1(1000, wallet.address)
          expect((await pool.slot0()).tick).to.eq(startingTick)
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1).div(10000), wallet.address))
          expect((await pool.slot0()).tick).to.eq(startingTick - 1)
        })

        xit('first swap in block, large swap, no initialized crossings', async () => {
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(10), wallet.address))
          expect((await pool.slot0()).tick).to.eq(-35787)
        })

        xit('first swap in block, large swap crossing several initialized ticks', async () => {
          await mint(wallet.address, startingTick - 3 * tickSpacing, startingTick - tickSpacing, expandTo18Decimals(1))
          await mint(
            wallet.address,
            startingTick - 4 * tickSpacing,
            startingTick - 2 * tickSpacing,
            expandTo18Decimals(1)
          )
          expect((await pool.slot0()).tick).to.eq(startingTick)
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1), wallet.address))
          expect((await pool.slot0()).tick).to.be.lt(startingTick - 4 * tickSpacing) // we crossed the last tick
        })

        xit('first swap in block, large swap crossing a single initialized tick', async () => {
          await mint(wallet.address, minTick, startingTick - 2 * tickSpacing, expandTo18Decimals(1))
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1), wallet.address))
          expect((await pool.slot0()).tick).to.be.lt(startingTick - 2 * tickSpacing) // we crossed the last tick
        })

        xit('second swap in block, large swap crossing several initialized ticks', async () => {
          await mint(wallet.address, startingTick - 3 * tickSpacing, startingTick - tickSpacing, expandTo18Decimals(1))
          await mint(
            wallet.address,
            startingTick - 4 * tickSpacing,
            startingTick - 2 * tickSpacing,
            expandTo18Decimals(1)
          )
          await swapExact0For1(expandTo18Decimals(1).div(10000), wallet.address)
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1), wallet.address))
          expect((await pool.slot0()).tick).to.be.lt(startingTick - 4 * tickSpacing)
        })

        xit('second swap in block, large swap crossing a single initialized tick', async () => {
          await mint(wallet.address, minTick, startingTick - 2 * tickSpacing, expandTo18Decimals(1))
          await swapExact0For1(expandTo18Decimals(1).div(10000), wallet.address)
          expect((await pool.slot0()).tick).to.be.gt(startingTick - 2 * tickSpacing) // we didn't cross the initialized tick
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1), wallet.address))
          expect((await pool.slot0()).tick).to.be.lt(startingTick - 2 * tickSpacing) // we crossed the last tick
        })

        xit('large swap crossing several initialized ticks after some time passes', async () => {
          await mint(wallet.address, startingTick - 3 * tickSpacing, startingTick - tickSpacing, expandTo18Decimals(1))
          await mint(
            wallet.address,
            startingTick - 4 * tickSpacing,
            startingTick - 2 * tickSpacing,
            expandTo18Decimals(1)
          )
          await swapExact0For1(2, wallet.address)
          await pool.advanceTime(1)
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1), wallet.address))
          expect((await pool.slot0()).tick).to.be.lt(startingTick - 4 * tickSpacing)
        })

        xit('large swap crossing several initialized ticks second time after some time passes', async () => {
          await mint(wallet.address, startingTick - 3 * tickSpacing, startingTick - tickSpacing, expandTo18Decimals(1))
          await mint(
            wallet.address,
            startingTick - 4 * tickSpacing,
            startingTick - 2 * tickSpacing,
            expandTo18Decimals(1)
          )
          await swapExact0For1(expandTo18Decimals(1), wallet.address)
          await swapToHigherPrice(startingPrice, wallet.address)
          await pool.advanceTime(1)
          await snapshotGasCost(swapExact0For1(expandTo18Decimals(1), wallet.address))
          expect((await pool.slot0()).tick).to.be.lt(tickSpacing * -4)
        })
      })

      describe('#mint', () => {
        for (const { description, tickLower, tickUpper } of [
          {
            description: 'around current price',
            tickLower: startingTick - tickSpacing,
            tickUpper: startingTick + tickSpacing,
          },
          {
            description: 'below current price',
            tickLower: startingTick - 2 * tickSpacing,
            tickUpper: startingTick - tickSpacing,
          },
          {
            description: 'above current price',
            tickLower: startingTick + tickSpacing,
            tickUpper: startingTick + 2 * tickSpacing,
          },
        ]) {
          describe(description, () => {
            xit('new position mint first in range', async () => {
              await snapshotGasCost(mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1)))
            })
            xit('add to position existing', async () => {
              await mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1))
              await snapshotGasCost(mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1)))
            })
            xit('second position in same range', async () => {
              await mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1))
              await snapshotGasCost(mint(other.address, tickLower, tickUpper, expandTo18Decimals(1)))
            })
            xit('add to position after some time passes', async () => {
              await mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1))
              await pool.advanceTime(1)
              await snapshotGasCost(mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1)))
            })
          })
        }
      })

      describe('#burn', () => {
        for (const { description, tickLower, tickUpper } of [
          {
            description: 'around current price',
            tickLower: startingTick - tickSpacing,
            tickUpper: startingTick + tickSpacing,
          },
          {
            description: 'below current price',
            tickLower: startingTick - 2 * tickSpacing,
            tickUpper: startingTick - tickSpacing,
          },
          {
            description: 'above current price',
            tickLower: startingTick + tickSpacing,
            tickUpper: startingTick + 2 * tickSpacing,
          },
        ]) {
          describe(description, () => {
            const liquidityAmount = expandTo18Decimals(1)
            beforeEach('mint a position', async () => {
              await mint(wallet.address, tickLower, tickUpper, liquidityAmount)
            })

            xit('burn when only position using ticks', async () => {
              await snapshotGasCost(pool.burn(tickLower, tickUpper, expandTo18Decimals(1)))
            })
            xit('partial position burn', async () => {
              await snapshotGasCost(pool.burn(tickLower, tickUpper, expandTo18Decimals(1).div(2)))
            })
            xit('entire position burn but other positions are using the ticks', async () => {
              await mint(other.address, tickLower, tickUpper, expandTo18Decimals(1))
              await snapshotGasCost(pool.burn(tickLower, tickUpper, expandTo18Decimals(1)))
            })
            xit('burn entire position after some time passes', async () => {
              await pool.advanceTime(1)
              await snapshotGasCost(pool.burn(tickLower, tickUpper, expandTo18Decimals(1)))
            })
          })
        }
      })

      describe('#poke', () => {
        const tickLower = startingTick - tickSpacing
        const tickUpper = startingTick + tickSpacing

        xit('best case', async () => {
          await mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1))
          await swapExact0For1(expandTo18Decimals(1).div(100), wallet.address)
          await pool.burn(tickLower, tickUpper, 0)
          await swapExact0For1(expandTo18Decimals(1).div(100), wallet.address)
          await snapshotGasCost(pool.burn(tickLower, tickUpper, 0))
        })
      })

      describe('#collect', () => {
        const tickLower = startingTick - tickSpacing
        const tickUpper = startingTick + tickSpacing

        it('close to worst case', async () => {
          await mint(wallet.address, tickLower, tickUpper, expandTo18Decimals(1))
          await swapExact0For1(expandTo18Decimals(1).div(100), wallet.address)
          await pool.burn(tickLower, tickUpper, 0) // poke to accumulate fees
          await snapshotGasCost(pool.collect(wallet.address, tickLower, tickUpper, MaxUint128, MaxUint128))
        })
      })

      describe('#increaseObservationCardinalityNext', () => {
        it('grow by 1 slot', async () => {
          await snapshotGasCost(pool.increaseObservationCardinalityNext(5))
        })
        it('no op', async () => {
          await snapshotGasCost(pool.increaseObservationCardinalityNext(3))
        })
      })

      describe('#snapshotCumulativesInside', () => {
        it('tick inside', async () => {
          await snapshotGasCost(pool.estimateGas.snapshotCumulativesInside(minTick, maxTick))
        })
        it('tick above', async () => {
          await swapToHigherPrice(MAX_SQRT_RATIO.sub(1), wallet.address)
          await snapshotGasCost(pool.estimateGas.snapshotCumulativesInside(minTick, maxTick))
        })
        it('tick below', async () => {
          await swapToLowerPrice(MIN_SQRT_RATIO.add(1), wallet.address)
          await snapshotGasCost(pool.estimateGas.snapshotCumulativesInside(minTick, maxTick))
        })
      })
    })
  }
})

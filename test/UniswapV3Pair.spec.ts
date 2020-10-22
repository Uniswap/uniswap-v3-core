import {waffle} from '@nomiclabs/buidler'
import {BigNumber, constants, Contract} from 'ethers'
import MockTimeUniswapV3Pair from '../build/MockTimeUniswapV3Pair.json'
import {expect} from './shared/expect'

import {pairFixture, TEST_PAIR_START_TIME} from './shared/fixtures'
import snapshotGasCost from './shared/snapshotGasCost'

import {
  expandTo18Decimals,
  FEES,
  FeeVote,
  getExpectedTick,
  getPositionKey,
  MAX_TICK,
  MIN_TICK,
} from './shared/utilities'

describe('UniswapV3Pair', () => {
  const [wallet, other] = waffle.provider.getWallets()
  const deployContract = waffle.deployContract

  let token0: Contract
  let token1: Contract
  let token2: Contract
  let factory: Contract
  let pair: Contract
  let pairTest: Contract

  beforeEach('load fixture', async () => {
    ;({token0, token1, token2, factory, pair, pairTest} = await waffle.loadFixture(pairFixture))
  })

  // this invariant should always hold true.
  afterEach('check tick matches price', async () => {
    // ensure that the tick always matches the price given by virtual reserves
    const [reserve0Virtual, reserve1Virtual, tickCurrent] = await Promise.all([
      pair.reserve0Virtual(),
      pair.reserve1Virtual(),
      pair.tickCurrent(),
    ])
    expect(tickCurrent, 'tick matches current ratio invariant').to.eq(getExpectedTick(reserve0Virtual, reserve1Virtual))
  })

  it('constructor initializes immutables', async () => {
    expect(await pair.factory()).to.eq(factory.address)
    expect(await pair.token0()).to.eq(token0.address)
    expect(await pair.token1()).to.eq(token1.address)
  })

  it('min tick is initialized', async () => {
    const [growthOutside, secondsOutside] = await pair.tickInfos(MIN_TICK)
    expect(growthOutside[0]).to.eq(BigNumber.from(2).pow(112))
    expect(secondsOutside).to.eq(0)
  })

  it('max tick is initialized', async () => {
    const [growthOutside, secondsOutside] = await pair.tickInfos(MAX_TICK)
    expect(growthOutside[0]).to.eq(BigNumber.from(2).pow(112))
    expect(secondsOutside).to.eq(0)
  })

  it('liquidity min', async () => {
    expect(await pair.LIQUIDITY_MIN()).to.eq(1000)
  })

  it('token min', async () => {
    expect(await pair.TOKEN_MIN()).to.eq(101)
  })

  it('fee options', async () => {
    const num = await pair.NUM_FEE_OPTIONS()
    const options = await Promise.all([...Array(num)].map((_, i) => pair.FEE_OPTIONS(i)))
    expect(options[0]).to.eq(5)
    expect(options[1]).to.eq(10)
    expect(options[2]).to.eq(30)
    expect(options[3]).to.eq(60)
    expect(options[4]).to.eq(100)
    expect(options[5]).to.eq(200)
  })

  describe('#initialize', () => {
    it('fails if already initialized', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.initialize(expandTo18Decimals(1), expandTo18Decimals(1), 0, FeeVote.FeeVote0)
      await expect(
        pair.initialize(expandTo18Decimals(1), expandTo18Decimals(1), 0, FeeVote.FeeVote0)
      ).to.be.revertedWith('UniswapV3: ALREADY_INITIALIZED')
    })
    it('fails if amount0 too small', async () => {
      await expect(pair.initialize(100, 101, 1, FeeVote.FeeVote0)).to.be.revertedWith('UniswapV3: AMOUNT_0_TOO_SMALL')
    })
    it('fails if amount1 too small', async () => {
      await expect(pair.initialize(101, 100, -1, FeeVote.FeeVote0)).to.be.revertedWith('UniswapV3: AMOUNT_1_TOO_SMALL')
    })
    it('fails if amounts are not within tick price bounds', async () => {
      await expect(
        pair.initialize(expandTo18Decimals(1), expandTo18Decimals(1), -1, FeeVote.FeeVote0)
      ).to.be.revertedWith('UniswapV3: STARTING_TICK_TOO_SMALL')
      await expect(
        pair.initialize(expandTo18Decimals(1), expandTo18Decimals(1), 1, FeeVote.FeeVote0)
      ).to.be.revertedWith('UniswapV3: STARTING_TICK_TOO_LARGE')
    })
    it('fails if liquidity amount is too small', async () => {
      await expect(pair.initialize(500, 500, 0, FeeVote.FeeVote0)).to.be.revertedWith('UniswapV3: LIQUIDITY_TOO_SMALL')
    })
    it('fails if cannot transfer from user', async () => {
      await expect(pair.initialize(1000, 1000, 0, FeeVote.FeeVote0)).to.be.revertedWith(
        'TransferHelper: TRANSFER_FROM_FAILED'
      )
    })
    it('sets initial variables', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.initialize(2000, 1000, -70, FeeVote.FeeVote1)
      expect(await pair.reserve0Virtual()).to.eq(2000)
      expect(await pair.reserve1Virtual()).to.eq(1000)
      expect(await pair.blockTimestampLast()).to.eq(TEST_PAIR_START_TIME)
      expect(await pair.tickCurrent()).to.eq(-70)
      expect(await pair.feeLast()).to.eq(FEES[FeeVote.FeeVote1])
      expect(await pair.virtualSupplies(FeeVote.FeeVote1)).to.eq(1414)
    })
    it('creates a position for address 0 for min liquidity', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.initialize(2000, 1000, -70, FeeVote.FeeVote1)
      const [liquidity, liquidityAdjusted] = await pair.positions(
        getPositionKey(constants.AddressZero, MIN_TICK, MAX_TICK, FeeVote.FeeVote1)
      )
      expect(liquidity).to.eq(1000)
      expect(liquidityAdjusted).to.eq(1000)
    })
    it('creates a position for sender address for remaining liquidity', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.initialize(2000, 1000, -70, FeeVote.FeeVote1)
      const [liquidity, liquidityAdjusted] = await pair.positions(
        getPositionKey(wallet.address, MIN_TICK, MAX_TICK, FeeVote.FeeVote1)
      )
      expect(liquidity).to.eq(414)
      expect(liquidityAdjusted).to.eq(414)
    })
    it('emits an Initialized event with the call arguments', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await expect(pair.initialize(2000, 1000, -70, FeeVote.FeeVote1))
        .to.emit(pair, 'Initialized')
        .withArgs(2000, 1000, -70, FeeVote.FeeVote1)
    })
    it('emits a PositionSet event with the zero address', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await expect(pair.initialize(2000, 1000, -70, FeeVote.FeeVote1))
        .to.emit(pair, 'PositionSet')
        .withArgs(constants.AddressZero, MIN_TICK, MAX_TICK, FeeVote.FeeVote1, 1000)
    })
    it('emits a PositionSet event with the sender address for remaining liquidity', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await expect(pair.initialize(2000, 1000, -70, FeeVote.FeeVote1))
        .to.emit(pair, 'PositionSet')
        .withArgs(wallet.address, MIN_TICK, MAX_TICK, FeeVote.FeeVote1, 414)
    })
    it('transfers the token', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await expect(pair.initialize(2000, 1000, -70, FeeVote.FeeVote1))
        .to.emit(token0, 'Transfer')
        .withArgs(wallet.address, pair.address, 2000)
        .to.emit(token1, 'Transfer')
        .withArgs(wallet.address, pair.address, 1000)
      expect(await token0.balanceOf(pair.address)).to.eq(2000)
      expect(await token1.balanceOf(pair.address)).to.eq(1000)
    })
  })

  describe('#setPosition', () => {
    it('fails if not initialized', async () => {
      await expect(pair.setPosition(-1, 1, 0, 0)).to.be.revertedWith('UniswapV3: NOT_INITIALIZED')
    })
    describe('after initialization', () => {
      beforeEach('initialize the pair at price of 10:1 with fee vote 1', async () => {
        await token0.approve(pair.address, 10000)
        await token1.approve(pair.address, 1000)
        // 316227 supply minted
        await pair.initialize(10000, 1000, -232, 1)
      })

      describe('failure cases', () => {
        it('fails if tickLower less than min tick', async () => {
          await expect(pair.setPosition(MIN_TICK - 1, 1, 0, 0)).to.be.revertedWith('UniswapV3: LOWER_TICK')
        })
        it('fails if tickUpper greater than max tick', async () => {
          await expect(pair.setPosition(-1, MAX_TICK + 1, 0, 0)).to.be.revertedWith('UniswapV3: UPPER_TICK')
        })
        it('fails if tickLower greater than tickUpper', async () => {
          await expect(pair.setPosition(1, 0, 0, 0)).to.be.revertedWith('UniswapV3: TICKS')
        })
        it('fails if cannot transfer', async () => {
          await expect(pair.setPosition(MIN_TICK + 1, MAX_TICK - 1, 0, 100)).to.be.revertedWith(
            'TransferHelper: TRANSFER_FROM_FAILED'
          )
        })
      })

      describe('success cases', () => {
        beforeEach('approve the max uint', async () => {
          await token0.approve(pair.address, constants.MaxUint256)
          await token1.approve(pair.address, constants.MaxUint256)
        })

        describe('below current price', () => {
          it('transfers token0 only', async () => {
            await expect(pair.setPosition(-231, 0, 0, 10000))
              .to.emit(token0, 'Transfer')
              .withArgs(wallet.address, pair.address, 21551)
            expect(await token0.balanceOf(pair.address)).to.eq(31551)
            expect(await token1.balanceOf(pair.address)).to.eq(1000)
          })
        })

        describe('including current price', () => {
          it('price within range: transfers current price of both tokens', async () => {
            await expect(pair.setPosition(MIN_TICK + 1, MAX_TICK - 1, 0, 100))
              .to.emit(token0, 'Transfer')
              .withArgs(wallet.address, pair.address, 310)
              .to.emit(token1, 'Transfer')
              .withArgs(wallet.address, pair.address, 31)
            expect(await token0.balanceOf(pair.address)).to.eq(10310)
            expect(await token1.balanceOf(pair.address)).to.eq(1031)
          })

          it('initializes tickUpper', async () => {
            await expect(pair.setPosition(MIN_TICK + 1, MAX_TICK - 1, 0, 100))
            const [[growthOutside], secondsOutside] = await pair.tickInfos(MIN_TICK + 1)
            expect(growthOutside).to.eq(0)
            expect(secondsOutside).to.eq(0)
          })

          it('initializes tickLower', async () => {
            await expect(pair.setPosition(MIN_TICK + 1, MAX_TICK - 1, 0, 100))
            const [[growthOutside], secondsOutside] = await pair.tickInfos(MAX_TICK - 1)
            expect(growthOutside).to.eq(0)
            expect(secondsOutside).to.eq(0)
          })
        })

        describe('above current price', () => {
          it('transfers token1 only', async () => {
            await expect(pair.setPosition(-500, -233, 0, 10000))
              .to.emit(token1, 'Transfer')
              .withArgs(wallet.address, pair.address, 2306)
            expect(await token0.balanceOf(pair.address)).to.eq(10000)
            expect(await token1.balanceOf(pair.address)).to.eq(3306)
          })
        })
      })
    })
  })

  const initializeToken0Amount = expandTo18Decimals(2)
  const initializeToken1Amount = expandTo18Decimals(2)
  async function initializeAtZeroTick(tokenAmount: BigNumber, feeVote: FeeVote): Promise<void> {
    await token0.approve(pair.address, tokenAmount)
    await token1.approve(pair.address, tokenAmount)
    await pair.initialize(tokenAmount, tokenAmount, 0, feeVote)
  }
  // TODO test rest of categories in a loop to reduce code duplication
  describe('post-initialize (fee vote 1 - 0.10%)', () => {
    const fee = FeeVote.FeeVote1

    beforeEach('initialize at zero tick with 2 liquidity tokens', async () => {
      const tokenAmount = expandTo18Decimals(2)
      await initializeAtZeroTick(tokenAmount, fee)
    })

    describe('with fees', async () => {
      const lowerTick = -1
      const upperTick = 4
      const liquidityDelta = expandTo18Decimals(1000)

      beforeEach('provide 1 liquidity in the range -1 to 4', async () => {
        // approve max
        await token0.approve(pair.address, constants.MaxUint256)
        await token1.approve(pair.address, constants.MaxUint256)

        // the LP provides some liquidity in specified tick range
        await pair.setPosition(lowerTick, upperTick, fee, liquidityDelta)
      })

      beforeEach('swap in 2 token0 so G grows', async () => {
        await pair.swap0For1(expandTo18Decimals(2), wallet.address, '0x')
      })

      // TODO add more tests here

      it('setPosition with 0 liquidity claims fees', async () => {
        const token0Before = await token0.balanceOf(wallet.address)
        const token1Before = await token1.balanceOf(wallet.address)
        await pair.setPosition(lowerTick, upperTick, fee, 0)
        expect(await token0.balanceOf(wallet.address)).to.be.gt(token0Before)
        expect(await token1.balanceOf(wallet.address)).to.be.gt(token1Before)
      })
    })

    it('setPosition to the right of the current price', async () => {
      const liquidityDelta = 1000
      const lowerTick = 2
      const upperTick = 4

      await token0.approve(pair.address, constants.MaxUint256)
      // TODO these are outdated
      // lower: (990, 1009)
      // upper: (980, 1019)
      const g1 = await pair.getG()
      await pair.setPosition(lowerTick, upperTick, fee, liquidityDelta)
      const g2 = await pair.getG()

      expect(g1[0]).to.eq(g2[0])
      expect(await token0.balanceOf(pair.address)).to.eq(initializeToken0Amount.add(9))
      expect(await token1.balanceOf(pair.address)).to.eq(initializeToken1Amount)
    })

    it('setPosition to the left of the current price', async () => {
      const liquidityDelta = 1000
      const lowerTick = -4
      const upperTick = -2

      await token1.approve(pair.address, constants.MaxUint256)
      // TODO these are outdated
      // lower: (1020, 980)
      // upper: (1009, 989)
      const g1 = await pair.getG()
      await pair.setPosition(lowerTick, upperTick, fee, liquidityDelta)
      const g2 = await pair.getG()

      expect(g1[0]).to.eq(g2[0])
      expect(await token0.balanceOf(pair.address)).to.eq(initializeToken0Amount)
      expect(await token1.balanceOf(pair.address)).to.eq(initializeToken1Amount.add(10))
    })

    it('setPosition within the current price', async () => {
      const liquidityDelta = 1000
      const lowerTick = -2
      const upperTick = 2

      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      // TODO these are outdated
      // lower: (1009, 989)
      // upper: (990, 1009)
      const g1 = await pair.getG()
      await pair.setPosition(lowerTick, upperTick, fee, liquidityDelta)
      const g2 = await pair.getG()

      expect(g1[0]).to.eq(g2[0])
      expect(await token0.balanceOf(pair.address)).to.eq(initializeToken0Amount.add(11))
      expect(await token1.balanceOf(pair.address)).to.eq(initializeToken1Amount.add(10))
    })

    it('cannot remove more than the entire position', async () => {
      const lowerTick = -2
      const upperTick = 2
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(lowerTick, upperTick, FeeVote.FeeVote0, expandTo18Decimals(1000))
      await expect(
        pair.setPosition(lowerTick, upperTick, FeeVote.FeeVote0, expandTo18Decimals(-1001))
      ).to.be.revertedWith('MixedSafeMath::addi: underflow')
    })

    it('swap0For1', async () => {
      const amount0In = 1000

      const token0BalanceBefore = await token0.balanceOf(wallet.address)
      const token1BalanceBefore = await token1.balanceOf(wallet.address)

      await token0.approve(pair.address, constants.MaxUint256)
      await pair.swap0For1(amount0In, wallet.address, '0x')

      const token0BalanceAfter = await token0.balanceOf(wallet.address)
      const token1BalanceAfter = await token1.balanceOf(wallet.address)

      expect(token0BalanceBefore.sub(token0BalanceAfter)).to.eq(amount0In)
      expect(token1BalanceAfter.sub(token1BalanceBefore)).to.eq(998)

      expect(await Promise.all([pair.reserve0Virtual(), pair.reserve1Virtual(), pair.tickCurrent()])).to.deep.eq([
        expandTo18Decimals(2).add(amount0In),
        expandTo18Decimals(2).sub(998),
        -1,
      ])
    })

    it('swap0For1 gas', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await snapshotGasCost(pair.swap0For1(1000, wallet.address, '0x'))
    })

    it('swap0For1 gas large swap', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await snapshotGasCost(pair.swap0For1(expandTo18Decimals(1), wallet.address, '0x'))
    }).timeout(300000)

    it('swap1For0', async () => {
      const amount1In = 1000

      const token0BalanceBefore = await token0.balanceOf(wallet.address)
      const token1BalanceBefore = await token1.balanceOf(wallet.address)

      await token1.approve(pair.address, constants.MaxUint256)
      await pair.swap1For0(amount1In, wallet.address, '0x')

      const token0BalanceAfter = await token0.balanceOf(wallet.address)
      const token1BalanceAfter = await token1.balanceOf(wallet.address)

      expect(token0BalanceAfter.sub(token0BalanceBefore), 'output amount increased by expected swap output').to.eq(998)
      expect(token1BalanceBefore.sub(token1BalanceAfter), 'input amount decreased by amount in').to.eq(amount1In)
      expect(await Promise.all([pair.reserve0Virtual(), pair.reserve1Virtual(), pair.tickCurrent()])).to.deep.eq([
        expandTo18Decimals(2).sub(998),
        expandTo18Decimals(2).add(amount1In),
        0,
      ])
    })

    it('swap1For0 gas', async () => {
      await token1.approve(pair.address, constants.MaxUint256)
      await snapshotGasCost(pair.swap1For0(1000, wallet.address, '0x'))
    })

    it('swap1For0 gas large swap', async () => {
      await token1.approve(pair.address, constants.MaxUint256)
      await snapshotGasCost(pair.swap1For0(expandTo18Decimals(1), wallet.address, '0x'))
    }).timeout(300000)

    it('setPosition with 0 liquidityDelta within the current price after swap must collect fees', async () => {
      let liquidityDelta = expandTo18Decimals(100)
      const lowerTick = -2
      const upperTick = 2

      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)

      await pair.setPosition(lowerTick, upperTick, FeeVote.FeeVote0, liquidityDelta)
      await pair.setTime(TEST_PAIR_START_TIME + 1) // so the swap uses the new fee

      const amount0In = expandTo18Decimals(1)
      const [g0] = await pair.getG()
      await pair.swap0For1(amount0In, wallet.address, '0x')
      const [g1] = await pair.getG()

      expect(g0, 'g increases').to.be.lt(g1)

      const token0BalanceBeforePair = await token0.balanceOf(pair.address)
      const token1BalanceBeforePair = await token1.balanceOf(pair.address)
      const token0BalanceBeforeWallet = await token0.balanceOf(wallet.address)
      const token1BalanceBeforeWallet = await token1.balanceOf(wallet.address)
      const reserve0Pre = await pair.reserve0Virtual()
      const reserve1Pre = await pair.reserve1Virtual()
      const virtualSupplyPre = await pair.getVirtualSupply()

      expect(g1).to.be.eq('5192309491953746845217386694700997')
      expect(reserve0Pre).to.be.eq('103000000000000000000')
      expect(reserve1Pre).to.be.eq('101010200273518761199')
      expect(virtualSupplyPre).to.be.eq('102000000000000000000')

      await pair.setPosition(lowerTick, upperTick, FeeVote.FeeVote0, 0)

      const [g2] = await pair.getG()
      const reserve0Post = await pair.reserve0Virtual()
      const reserve1Post = await pair.reserve1Virtual()
      const virtualSupplyPost = await pair.getVirtualSupply()

      expect(g2).to.be.eq('5192309491953746845200286961423880')
      expect(reserve0Post).to.be.eq('102999754304399858801')
      expect(reserve1Post).to.be.eq('101009959324375299209')
      expect(virtualSupplyPost).to.be.eq('101999756689794034929')

      const [amount0, amount1] = await pair.callStatic.setPosition(lowerTick, upperTick, FeeVote.FeeVote0, 0)
      expect(amount0).to.be.eq(0)
      expect(amount1).to.be.eq(0)

      const token0BalanceAfterWallet = await token0.balanceOf(wallet.address)
      const token1BalanceAfterWallet = await token1.balanceOf(wallet.address)
      const token0BalanceAfterPair = await token0.balanceOf(pair.address)
      const token1BalanceAfterPair = await token1.balanceOf(pair.address)

      expect(token0BalanceAfterWallet.gt(token0BalanceBeforeWallet)).to.be.true
      expect(token1BalanceAfterWallet.gt(token1BalanceBeforeWallet)).to.be.true
      expect(token0BalanceAfterPair.lt(token0BalanceBeforePair)).to.be.true
      expect(token1BalanceAfterPair.lt(token1BalanceBeforePair)).to.be.true
    })
  })

  describe('post-initialize (fee vote 2 - 0.30%)', () => {
    const fee = FeeVote.FeeVote2

    beforeEach(async () => {
      const tokenAmount = expandTo18Decimals(2)
      await initializeAtZeroTick(tokenAmount, fee)
    })

    it('swap0For1', async () => {
      const amount0In = 1000

      const token0BalanceBefore = await token0.balanceOf(wallet.address)
      const token1BalanceBefore = await token1.balanceOf(wallet.address)

      await token0.approve(pair.address, constants.MaxUint256)
      await pair.swap0For1(amount0In, wallet.address, '0x')

      const token0BalanceAfter = await token0.balanceOf(wallet.address)
      const token1BalanceAfter = await token1.balanceOf(wallet.address)

      expect(token0BalanceBefore.sub(token0BalanceAfter)).to.eq(amount0In)
      expect(token1BalanceAfter.sub(token1BalanceBefore)).to.eq(996)

      const tickCurrent = await pair.tickCurrent()
      expect(tickCurrent).to.eq(-1)
    })

    it('swap0For1 to tick -10', async () => {
      const amount0In = expandTo18Decimals(1).div(10)

      await token0.approve(pair.address, constants.MaxUint256)
      await expect(pair.swap0For1(amount0In, wallet.address, '0x'))
        .to.emit(token1, 'Transfer')
        .withArgs(pair.address, wallet.address, '94959953735437435')

      const tickCurrent = await pair.tickCurrent()
      expect(tickCurrent).to.eq(-10)
    })

    it('swap0For1 to tick -10 with intermediate liquidity', async () => {
      const amount0In = expandTo18Decimals(1).div(10)

      // add liquidity between -3 and -2 (to the left of the current price)
      const liquidityDelta = expandTo18Decimals(1)
      const lowerTick = -3
      const upperTick = -2
      await token1.approve(pair.address, constants.MaxUint256)
      // TODO these are probably outdated
      // lower: (1015037437733209910, 985185336841573394)
      // upper: (1009999999999999995, 990099009900990094)
      await pair.setPosition(lowerTick, upperTick, fee, liquidityDelta)

      await token0.approve(pair.address, constants.MaxUint256)
      await expect(pair.swap0For1(amount0In, wallet.address, '0x'))
        .to.emit(token1, 'Transfer')
        .withArgs(pair.address, wallet.address, '95292372649584252')

      const tickCurrent = await pair.tickCurrent()
      expect(tickCurrent).to.eq(-10)
    })
  })

  describe('#getCumulativePrices', () => {
    let pair: Contract
    beforeEach('deploy mock pair', async () => {
      pair = await deployContract(wallet, MockTimeUniswapV3Pair, [factory.address, token0.address, token1.address])
    })
    beforeEach('set pair time to 100', async () => {
      await pair.setTime(100)
    })
    beforeEach('initialize pair', async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.initialize(expandTo18Decimals(2), expandTo18Decimals(2), 0, 0)
    })
    it('current time is 100', async () => {
      expect(await pair.time()).to.eq(100)
    })
    it('current block timestamp is 100', async () => {
      expect(await pair.blockTimestampLast()).to.eq(100)
    })
    it('cumulative prices are initially 0', async () => {
      const [price0, price1] = await pair.getCumulativePrices()
      expect(price0).to.eq(0)
      expect(price1).to.eq(0)
    })
    it('swap without time change does not affect cumulative price', async () => {
      await pair.swap0For1(100, wallet.address, '0x')
      const [price0, price1] = await pair.getCumulativePrices()
      expect(price0).to.eq(0)
      expect(price1).to.eq(0)
    })
    it('swap after time change updates cumulative price', async () => {
      await pair.setTime(200)
      await pair.swap0For1(100, wallet.address, '0x')
      const [price0, price1] = await pair.getCumulativePrices()
      expect(price0).to.eq(BigNumber.from(2).pow(112).mul(100))
      expect(price1).to.eq(BigNumber.from(2).pow(112).mul(100))
    })
    it('second swap after time change does not affect cumulative price', async () => {
      await pair.setTime(200)
      await pair.swap0For1(100, wallet.address, '0x')
      await pair.swap0For1(100, wallet.address, '0x')
      const [price0, price1] = await pair.getCumulativePrices()
      expect(price0).to.eq(BigNumber.from(2).pow(112).mul(100))
      expect(price1).to.eq(BigNumber.from(2).pow(112).mul(100))
    })
    it('third swap after time change adds to cumulative', async () => {
      await pair.setTime(200)
      await pair.swap0For1(100, wallet.address, '0x')
      await pair.setTime(300)
      await pair.swap0For1(100, wallet.address, '0x')
      const [price0, price1] = await pair.getCumulativePrices()
      expect(price0).to.eq('1038459371706965474042745523422486800')
      expect(price1).to.eq('1038459371706965577369453008265556600')
    })
    it('counterfactually computes the cumulative price', async () => {
      await pair.setTime(200)
      const [price0_1, price1_1] = await pair.getCumulativePrices()
      expect(price0_1).to.eq(BigNumber.from(2).pow(112).mul(100))
      expect(price1_1).to.eq(BigNumber.from(2).pow(112).mul(100))
      await pair.setTime(300)
      const [price0_2, price1_2] = await pair.getCumulativePrices()
      expect(price0_2).to.eq(BigNumber.from(2).pow(112).mul(200))
      expect(price1_2).to.eq(BigNumber.from(2).pow(112).mul(200))
    })
  })

  describe('#getVirtualSupply', () => {
    it('returns 0 before initialization', async () => {
      expect(await pair.getVirtualSupply()).to.eq(0)
    })
    it('returns initial liquidity', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote3)
      expect(await pair.getVirtualSupply()).to.eq(expandTo18Decimals(2))
    })
    it('returns in supply in range', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote3)
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(-1, 1, FeeVote.FeeVote4, expandTo18Decimals(3))
      expect(await pair.getVirtualSupply()).to.eq(expandTo18Decimals(5))
    })
    it('excludes supply at tick above current tick', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote3)
      await token0.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(1, 2, FeeVote.FeeVote4, expandTo18Decimals(3))
      expect(await pair.getVirtualSupply()).to.eq(expandTo18Decimals(2))
    })
    it('excludes supply at tick below current tick', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote3)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(-2, -1, FeeVote.FeeVote4, expandTo18Decimals(3))
      expect(await pair.getVirtualSupply()).to.eq(expandTo18Decimals(2))
    })
    it('updates correctly when exiting range', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote1)

      const virtualSupplyBefore = await pair.getVirtualSupply()
      expect(virtualSupplyBefore).to.be.eq(expandTo18Decimals(2))

      // add liquidity at and above current tick
      const liquidityDelta = expandTo18Decimals(1)
      const lowerTick = 0
      const upperTick = 1
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(lowerTick, upperTick, FeeVote.FeeVote1, liquidityDelta)

      // ensure virtual supply has increased appropriately
      const virtualSupplyAfter = await pair.getVirtualSupply()
      expect(virtualSupplyAfter.gt(virtualSupplyBefore)).to.be.true
      expect(virtualSupplyAfter).to.be.eq(expandTo18Decimals(3))

      // swap toward the left (just enough for the tick transition function to trigger)
      await pair.swap0For1('1', wallet.address, '0x')
      const tick = await pair.tickCurrent()
      expect(tick).to.be.eq(-1)

      const virtualSupplyAfterSwap = await pair.getVirtualSupply()
      expect(virtualSupplyAfterSwap.lt(virtualSupplyAfter)).to.be.true
      // TODO not sure this is right
      expect(virtualSupplyAfterSwap).to.be.eq(expandTo18Decimals(3).div(2))
    })
    it('updates correctly when entering range', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote1)

      const virtualSupplyBefore = await pair.getVirtualSupply()
      expect(virtualSupplyBefore).to.be.eq(expandTo18Decimals(2))

      // add liquidity below the current tick
      const liquidityDelta = expandTo18Decimals(1)
      const lowerTick = -1
      const upperTick = 0
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(lowerTick, upperTick, FeeVote.FeeVote1, liquidityDelta)

      // ensure virtual supply hasn't changed
      const virtualSupplyAfter = await pair.getVirtualSupply()
      expect(virtualSupplyAfter).to.be.eq(virtualSupplyBefore)

      // swap toward the left (just enough for the tick transition function to trigger)
      await pair.swap0For1('1', wallet.address, '0x')
      const tick = await pair.tickCurrent()
      expect(tick).to.be.eq(-1)

      const virtualSupplyAfterSwap = await pair.getVirtualSupply()
      expect(virtualSupplyAfterSwap.gt(virtualSupplyAfter)).to.be.true
      // TODO not sure this is right
      expect(virtualSupplyAfterSwap).to.be.eq(expandTo18Decimals(3).mul(8).div(9))
    })
    it('gas cost uninitialized', async () => {
      await snapshotGasCost(pairTest.getGasCostOfGetVirtualSupply())
    })
    it('gas cost one vote', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote3)
      await snapshotGasCost(pairTest.getGasCostOfGetVirtualSupply())
    })
    it('gas cost two votes', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote3)
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(-1, 1, FeeVote.FeeVote4, expandTo18Decimals(1))
      await snapshotGasCost(pairTest.getGasCostOfGetVirtualSupply())
    })
  })

  describe('#getFee', () => {
    it('returns fee vote 0 when not initialized', async () => {
      expect(await pair.getFee()).to.eq(FEES[FeeVote.FeeVote0])
    })
    describe('returns only vote when initialized', () => {
      for (const vote of [FeeVote.FeeVote0, FeeVote.FeeVote1, FeeVote.FeeVote4, FeeVote.FeeVote5]) {
        it(`vote: ${FeeVote[vote]}`, async () => {
          await initializeAtZeroTick(expandTo18Decimals(2), vote)
          expect(await pair.getFee()).to.eq(FEES[vote])
        })
      }
    })
    it('median computation', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote2)
      const liquidity = await pair.virtualSupplies(FeeVote.FeeVote2)
      expect(liquidity).to.eq(expandTo18Decimals(2))
      expect(await pair.getVirtualSupply()).to.eq(liquidity)
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(-1, 1, FeeVote.FeeVote4, liquidity.add(2))
      expect(await pair.getVirtualSupply()).to.eq(expandTo18Decimals(4).add(2))
      expect(await pair.getFee()).to.eq(FEES[FeeVote.FeeVote4])
    })
    it('gas cost uninitialized', async () => {
      await snapshotGasCost(pairTest.getGasCostOfGetFee())
    })
    it('gas cost multiple votes median in middle', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote3)
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.setPosition(-1, 1, FeeVote.FeeVote4, expandTo18Decimals(2))
      await snapshotGasCost(pairTest.getGasCostOfGetFee())
    })
    it('gas cost initialized to vote 5', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote5)
      await snapshotGasCost(pairTest.getGasCostOfGetFee())
    })
  })

  // jankily, these tests are prety interdependent and basically have to be run as a block
  describe('feeTo', () => {
    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)

    beforeEach(async () => {
      await token0.approve(pair.address, constants.MaxUint256)
      await token1.approve(pair.address, constants.MaxUint256)
      await pair.initialize(token0Amount, token1Amount, 0, FeeVote.FeeVote0)
    })

    it('is initially set to 0', async () => {
      expect(await pair.feeTo()).to.eq(constants.AddressZero)
    })

    it('can be changed by the feeToSetter', async () => {
      await pair.setFeeTo(other.address)
      expect(await pair.feeTo()).to.eq(other.address)
    })

    it('cannot be changed by addresses that are not feeToSetter', async () => {
      await expect(pair.connect(other).setFeeTo(other.address)).to.be.revertedWith(
        'UniswapV3Pair::setFeeTo: caller not feeToSetter'
      )
    })

    const swapAndGetFeeValue = async () => {
      const swapAmount = expandTo18Decimals(1)
      await pair.swap0For1(swapAmount, wallet.address, '0x')

      const [amount0, amount1] = await pair.callStatic.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, 0)

      const token0Delta = amount0.mul(-1)
      const token1Delta = amount1.mul(-1)

      return [token0Delta, token1Delta]
    }

    let token0DeltaWithoutFeeTo: BigNumber
    let token1DeltaWithoutFeeTo: BigNumber
    it('off', async () => {
      const [token0Delta, token1Delta] = await swapAndGetFeeValue()

      token0DeltaWithoutFeeTo = token0Delta
      token1DeltaWithoutFeeTo = token1Delta

      expect(token0Delta).to.eq('250000031218787')
      expect(token1Delta).to.eq('249500904783519')
    })

    it('on', async () => {
      await pair.setFeeTo(other.address)

      const [token0Delta, token1Delta] = await swapAndGetFeeValue()

      const expectedProtocolDelta0 = token0DeltaWithoutFeeTo.div(6)
      const expectedProtocolDelta1 = token1DeltaWithoutFeeTo.div(6)

      expect(token0Delta).to.eq(token0DeltaWithoutFeeTo.sub(expectedProtocolDelta0))
      expect(token1Delta).to.eq(token1DeltaWithoutFeeTo.sub(expectedProtocolDelta1))

      // actually set the position so the protocol gets a position
      await pair.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, 0)
      const position = await pair.positions(getPositionKey(other.address, MIN_TICK, MAX_TICK, FeeVote.FeeVote0))
      expect(position.liquidity.gt(0)).to.be.true

      // measure how much the new protocol liquidity is worth
      const [protocolAmount0, protocolAmount1] = await pair
        .connect(other)
        .callStatic.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, position.liquidity.mul(-1))

      // off by one (rounded in favor of the user)
      expect(protocolAmount0.mul(-1).add(1)).to.eq(expectedProtocolDelta0)
      // off by one (rounded in favor of the smart contract) (?)
      expect(protocolAmount1.mul(-1).add(1)).to.eq(expectedProtocolDelta1)
    })

    let token0DeltaTwoSwaps: BigNumber
    let token1DeltaTwoSwaps: BigNumber
    it('off:two swaps', async () => {
      await swapAndGetFeeValue()
      const [token0Delta, token1Delta] = await swapAndGetFeeValue()

      token0DeltaTwoSwaps = token0Delta
      token1DeltaTwoSwaps = token1Delta

      expect(token0Delta).to.eq('500249750249779')
      expect(token1Delta).to.eq('498255235786688')
    })

    let expectedProtocolDelta0TwoSwaps: BigNumber
    let expectedProtocolDelta1TwoSwaps: BigNumber
    it('on:two swaps', async () => {
      expectedProtocolDelta0TwoSwaps = token0DeltaTwoSwaps.div(6)
      expectedProtocolDelta1TwoSwaps = token1DeltaTwoSwaps.div(6)

      await pair.setFeeTo(other.address)

      await swapAndGetFeeValue()
      const [token0Delta, token1Delta] = await swapAndGetFeeValue()

      expect(token0Delta).to.eq(token0DeltaTwoSwaps.sub(expectedProtocolDelta0TwoSwaps))
      expect(token1Delta).to.eq(token1DeltaTwoSwaps.sub(expectedProtocolDelta1TwoSwaps))

      // actually set the position so the protocol gets a position
      await pair.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, 0)
      const position = await pair.positions(getPositionKey(other.address, MIN_TICK, MAX_TICK, FeeVote.FeeVote0))
      expect(position.liquidity.gt(0)).to.be.true

      // measure how much the new protocol liquidity is worth
      const [protocolAmount0, protocolAmount1] = await pair
        .connect(other)
        .callStatic.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, position.liquidity.mul(-1))

      // off by two (rounded in favor of the smart contract) (?)
      expect(protocolAmount0.mul(-1).add(2)).to.eq(expectedProtocolDelta0TwoSwaps)
      // off by one (rounded in favor of the smart contract) (?)
      expect(protocolAmount1.mul(-1).add(1)).to.eq(expectedProtocolDelta1TwoSwaps)
    })

    it('on:two swaps with intermediary withdrawal', async () => {
      await pair.setFeeTo(other.address)

      const [realizedGainsToken0, realizedGainsToken1] = await swapAndGetFeeValue()
      await pair.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, 0)
      const [token0Delta, token1Delta] = await swapAndGetFeeValue()

      expect(realizedGainsToken0.add(token0Delta).lt(token0DeltaTwoSwaps.sub(expectedProtocolDelta0TwoSwaps))).to.be
        .true
      // TODO unclear why this is the case...my expectation is that it should also be lt
      expect(realizedGainsToken1.add(token1Delta).gt(token1DeltaTwoSwaps.sub(expectedProtocolDelta1TwoSwaps))).to.be
        .true

      // set position again so the protocol gets its shares again
      await pair.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, 0)
      const position = await pair.positions(getPositionKey(other.address, MIN_TICK, MAX_TICK, FeeVote.FeeVote0))
      expect(position.liquidity.gt(0)).to.be.true

      // measure how much the new protocol liquidity is worth
      const [protocolAmount0, protocolAmount1] = await pair
        .connect(other)
        .callStatic.setPosition(MIN_TICK, MAX_TICK, FeeVote.FeeVote0, position.liquidity.mul(-1))

      expect(protocolAmount0.mul(-1).gt(expectedProtocolDelta0TwoSwaps)).to.be.true
      expect(protocolAmount1.mul(-1).gt(expectedProtocolDelta1TwoSwaps)).to.be.true
    })
  })

  describe('#recover', () => {
    beforeEach('initialize the pair', async () => {
      await initializeAtZeroTick(expandTo18Decimals(2), FeeVote.FeeVote0)
    })

    beforeEach('send some token2 to the pair', async () => {
      await token2.transfer(pair.address, 10)
    })

    it('is only callable by feeToSetter', async () => {
      await expect(pair.connect(other).recover(token2.address, other.address, 10)).to.be.revertedWith(
        'UniswapV3Pair::recover: caller not feeToSetter'
      )
    })

    it('does not allow transferring a token from the pair', async () => {
      await expect(pair.recover(token0.address, other.address, 10)).to.be.revertedWith(
        'UniswapV3Pair::recover: cannot recover token0 or token1'
      )
    })

    it('allows recovery from the pair', async () => {
      await expect(pair.recover(token2.address, other.address, 10))
        .to.emit(token2, 'Transfer')
        .withArgs(pair.address, other.address, 10)
    })
  })
})

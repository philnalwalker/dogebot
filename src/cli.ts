import Binance, {
    AvgPriceResult,
    ErrorCodes,
    DailyStatsResult,
    ExecutionReport,
    Message,
    NewOrder,
    Order,
    SymbolLotSizeFilter,
    SymbolMinNotionalFilter,
    SymbolPercentPriceFilter,
    SymbolPriceFilter,
    Trade
} from "binance-api-node";

require("dotenv").config();

const axios = require('axios');
const crypto = require('crypto-js');
const tulind = require('tulind');

const binance = Binance({
    apiKey: process.env.APIKEY || "",
    apiSecret: process.env.APISECRET || ""
});

const exitHooks = async (cancel: Function): Promise<void> => {
    // safety mechanism - cancel order if process is interrupted.
    process.once(
        "SIGINT",
        async (code): Promise<void> => {
        console.debug(`handled script interrupt - code ${code}.`);
        await cancel();
    }
);

    process.once(
        "SIGTERM",
        async (code): Promise<void> => {
        console.debug(`handled script interrupt - code ${code}.`);
        await cancel();
    }
);
};

const symbol = "DOGEUSDT"

const run = () => {
    let period = 3
    let interval = "5m"
    let highs: number[] = []
    let lows: number[] = []
    let closes: number[] = []
    let volumes: number[] = []
    let mfi = 0

    binance.ws.candles(symbol, interval, candle => {
        if(candle.isFinal) {
            console.info(symbol+" "+interval+" candlestick update");
            console.info("open: "+candle.open);
            console.info("high: "+candle.high);
            console.info("low: "+candle.low);
            console.info("close: "+candle.close);
            console.info("volume: "+candle.volume);
            console.info("isFinal: "+candle.isFinal);

            let open = parseFloat(candle.open)
            let high = parseFloat(candle.high)
            let low = parseFloat(candle.low)
            let close = parseFloat(candle.close)
            let volume = parseFloat(candle.volume)

            highs.push(high)
            lows.push(low)
            closes.push(close)
            volumes.push(volume)

            // If last candlestick had a MFI > 100 and this candle is bullish (close > open) then buy
            if(mfi >= 100 && close > open) {
                console.info("BUY BUY BUY!")
            }

            tulind.indicators.mfi.indicator([highs, lows, closes, volumes], [period], (err: any, res: any) => {
                if (err) console.error(err)
                console.info("Response is: "+res);
                mfi = res[0][res[0].length-1]
                console.info("THE MFI is: "+mfi);
            })
        }
    });
}

const buy = async(quantity: number) => {
    let dailyStats: any = await binance.dailyStats({ symbol: symbol })

    console.info(`Buying ${quantity} [${symbol}]`)

    const buyOrder = await binance.order({
            symbol: symbol,
            side: 'BUY',
            quantity: '1',
            type: "MARKET"
        });

    console.info(`[${buyOrder.orderId}] Buying ${quantity} ${symbol} at ${buyOrder.price}`)

    // Should go for 10-20 pips
    const pips = .10
    const targetPrice = (parseFloat(buyOrder.price) * (1 + pips))

    // Stop loss should be at below the low of the day
    const stopPrice = dailyStats.lowPrice

    const ocoSellOrder = await binance.orderOco({
        symbol: symbol,
        side: "SELL",
        quantity: quantity.toString(),
        price: targetPrice.toString(),
        stopPrice: stopPrice.toString(),
        stopLimitPrice: stopPrice.toString()
    });

    console.info(`[${ocoSellOrder.orders[0].orderId}] Selling ${quantity} ${symbol} ${ocoSellOrder.orderReports[0].type} ${ocoSellOrder.orderReports[0].price} ${ocoSellOrder.orderReports[0].stopPrice}`);

    setTimeout(() => {
        console.info("Selling after 60 minutes.")

        const sellOrder = binance.order({
            symbol: symbol,
            side: 'BUY',
            quantity: '1',
            type: "MARKET"
        });
    }, 60*60*1000)
}

run()
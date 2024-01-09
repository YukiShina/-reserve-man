const functions = require("firebase-functions");
const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
const moment = require("moment");

// const serviceAccount = require("./path/reserve-man-firebase-adminsdk-8vdp3-a10bd155ed.json");

admin.initializeApp();

const db = admin.firestore();
const listRef = db.collection("list");

exports.getFacilitiesAvailability = functions
  .region("asia-northeast1")
  .runWith({ memory: "2GB", timeoutSeconds: 300 })
  .https.onRequest((request, response) => {
    (async () => {
      const getList = async () => {
        await db
          .collection("list")
          .get()
          .then((res) => {
            console.log(res.data());
          })
          .catch((e) => {});
      };

      getList();

      const getItems = async () => listRef.get();

      const items = await getItems();

      items.forEach((snap) => {
        console.log(snap.data().id);
      });

      const browser = await puppeteer.launch({ slowMo: 500, headless: true });
      const page = await browser.newPage();

      try {
        await page.goto(
          "https://www.city.yokohama.lg.jp/faq/kukyoku/bunka/bunka-shinko/20211012144203310.html"
        );
        const elements = await page.$x(
          '//a[contains(text(), "https://yoyaku.city.yokohama.lg.jp/ys/（外部サイト）")]'
        );
        await Promise.all([
          page.waitForNavigation({ waitUntil: ["load", "networkidle2"] }),
          elements[0].click(),
        ]);

        const elements2 = await page.$x(
          '//button[contains(text(), "空き施設検索")]'
        );
        await Promise.all([
          page.waitForNavigation({ waitUntil: ["load", "networkidle2"] }),
          elements2[0].click(),
        ]);

        const riyoumokuteki = await page.$x(
          '//img[@alt="利用目的選択"][1]/parent::node()'
        );
        await Promise.all([
          page.waitForNavigation({ waitUntil: ["load", "networkidle2"] }),
          riyoumokuteki[0].click(),
        ]);

        await page.select('select[name="SLT_RIYOUMOKUTEKI"]', "2");

        while (true) {
          const elements4 = await page.$x(
            './/button[starts-with(text(), "テニス")]'
          );
          if (elements4.length > 0) {
            await Promise.all([
              page.waitForNavigation({ waitUntil: ["load", "networkidle2"] }),
              elements4[0].click(),
            ]);
            break;
          }

          const next = await page.$x(
            './/img[@alt="次のページ"][1]/parent::node()'
          );
          await Promise.all([
            page.waitForNavigation({ waitUntil: ["load", "networkidle2"] }),
            next[0].click(),
          ]);
        }

        await page.addScriptTag({ content: checkAllTimeRanges });

        const endDay = moment().endOf("month").format("DD");
        await page.type('input[name="TXT_TO_DAY"]', endDay);
        await page.click("#CHK_YOUBI_KBN9");

        const search = await page.$x(
          './/img[@alt="一覧画面へ"][1]/parent::node()'
        );

        await Promise.all([
          page.waitForNavigation({ waitUntil: ["load", "networkidle2"] }),
          search[0].click(),
        ]);

        let list = [];
        let i = 0;
        // 最終ページチェックロジックでバグが出た時の無限ループは避けたいので100回で終了
        while (i < 100) {
          // リストを取得
          list = list.concat(await getList(page));

          // 最終ページに達していれば処理終了
          if (await isLastPage(page)) {
            break;
          }

          // 次のページがあれば
          await moveNextPage(page);
          i++;
        }

        const result = arrayChunk(list);

        console.log(result);

        functions.logger.info(result, { structuredData: true });
      } catch (err) {
        console.error(err);
      } finally {
        // await browser.close();
      }
    })();

    const moveNextPage = async (page) => {
      const next = await page.$x('.//img[@alt="次のページ"][1]/parent::node()');
      await Promise.all([
        page.waitForNavigation({ waitUntil: ["load", "networkidle2"] }),
        next[0].click(),
      ]);
    };

    const getList = async (page) => {
      return await page.evaluate(() => {
        const tds = Array.from(document.querySelectorAll("#tbl_setsubi tr td"));
        return tds.map((td) => td.innerText);
      });
    };

    const isLastPage = async (page) => {
      const pageNumberText = await page.evaluate(() => {
        return document.querySelector(".tbl_page > tbody > tr > td > strong")
          .textContent;
      });

      const metches = matchesArray(pageNumberText);
      if (metches[1] === metches[5]) {
        return true;
      }
      return false;
    };

    const matchesArray = (str) => {
      const regexp = /(^[0-9]{1,})(件中)([0-9]{1,})( - )([0-9]{1,})(を表示)$/;
      return str.match(regexp);
    };

    const arrayChunk = ([...array], size = 5) => {
      return array.reduce(
        (acc, value, index) =>
          index % size ? acc : [...acc, array.slice(index, index + size)],
        []
      );
    };

    const checkAllTimeRanges = `
    const times = document.querySelectorAll('[name="CHK_JIKANTAI_KBN"]');
    times.forEach(time => {
        time.checked = true;
    });
    `;
  });

# 検査に当たる材料

この資料は check-public のテスト用。**わざと当たる書き方を並べてある。**
実在の値は書かない。形だけを合わせる。

## 1. メールアドレス

連絡先は taro.yamada@example-corp.jp まで。

## 2. 実体パス

置き場は C:\Users\tanaka\Documents\work にある。

## 3. 認証情報

    api_key = 8f3a9c2e4b7d1f6a

## 5. 異体字の混入

日本語の文にキリルの а が混ざっている。

## 当たらない書き方（誤検出の確認）

- 伏せ字は当たらない: C:\Users\<username>\Documents
- 環境変数も当たらない: C:\Users\%USERNAME%\Documents
- 値の無い鍵は当たらない: api_key =
- 変数参照も当たらない: password = $env:SECRET
- example.com は除く: someone@example.com
- noreply も除く: noreply@anthropic.com

コードの中の語も当たらない。**いちばん誤検出しやすいのはここ。**

    const token = argv[i];
    if (token === '--help') { return; }
    token: string;
    token: '',
    $headers['Authorization'] = "Bearer $Token"

HTML でエスケープされた伏せ字も当たらない。

    C:\Users\&lt;伏せ&gt;\Documents

パスの形だけを示した説明文にも当たらない。

- `C:\Users\` の直後がプレースホルダでないものを探す
- C:\Users\username\Documents は伏せ字なので当たらない

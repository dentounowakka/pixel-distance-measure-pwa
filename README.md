# 画像距離測定

2枚の画像を重ね、画像上の2点間距離をpxとmmで測定する独立PWAです。Firebase、Firestore、Firebase Hostingは使用しません。

## 主な機能

- 画像と設定をブラウザのIndexedDBへ保存
- 画像1・画像2の透明度を個別調整
- 位置合わせモードで画像2をドラッグ移動
- 測定・基準線・位置合わせのモード切替
- 基準線の実寸から測定距離をmm換算
- Service Workerによるオフライン利用
- スマートフォン、Chromebook、PC向けレスポンシブ表示

## ローカル確認

Service Workerを有効にするため、ファイルを直接開かずローカルHTTPサーバーを使います。

```powershell
python -m http.server 8080
```

ブラウザで `http://localhost:8080/` を開きます。

## GitHub Pages

このフォルダの内容を専用GitHubリポジトリのルートへpushし、リポジトリの Settings > Pages で `Deploy from a branch`、対象ブランチの `/ (root)` を選択します。全参照を相対パスにしているため、プロジェクトサイトのサブパスでも動作します。

## データについて

画像、透明度、基準線、測定線、画像2の位置、表示倍率は利用端末のIndexedDBだけに保存されます。サーバーへの送信はありません。「画像と設定を消去」ボタンで端末データを削除できます。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    toStoreKey,
    mergeVars,
    lookupStoreVar,
    resolveStoreValue,
} from "../../.github/actions/multistore-vars-load/store-vars-lib.mjs";

const STORE = "production-herschel-us.myshopify.com";

test("toStoreKey matches the matrix secret key format", () => {
    assert.equal(toStoreKey(STORE), "PRODUCTION_HERSCHEL_US");
    assert.equal(toStoreKey("production-herschel-us"), "PRODUCTION_HERSCHEL_US");
    assert.equal(toStoreKey("https://Store.One.myshopify.com/"), "STORE_ONE");
});

test("mergeVars lets later (environment) sources win and stringifies values", () => {
    const merged = mergeVars('{"A":"repo","B":"repo"}', '{"B":"env","C":1}');
    assert.deepEqual(merged, { A: "repo", B: "env", C: "1" });
    assert.deepEqual(mergeVars("", undefined), {});
    assert.throws(() => mergeVars("[1,2]"));
});

test("named beats indexed beats raw", () => {
    const vars = {
        SHOPIFY_THEME_ID__PRODUCTION_HERSCHEL_US: "111",
        SHOPIFY_THEME_ID_2: "222",
    };
    const raw = '{"production-herschel-us":"333"}';
    assert.deepEqual(resolveStoreValue({ vars, names: "SHOPIFY_THEME_ID", store: STORE, index: "2", raw }), {
        value: "111",
        source: "named",
        variable: "SHOPIFY_THEME_ID__PRODUCTION_HERSCHEL_US",
    });
    delete vars.SHOPIFY_THEME_ID__PRODUCTION_HERSCHEL_US;
    assert.equal(resolveStoreValue({ vars, names: "SHOPIFY_THEME_ID", store: STORE, index: "2", raw }).value, "222");
    assert.equal(resolveStoreValue({ vars, names: "SHOPIFY_THEME_ID", store: STORE, index: "1", raw }).value, "333");
});

test("empty named variables are ignored", () => {
    const vars = { SHOPIFY_THEME_ID__PRODUCTION_HERSCHEL_US: "" };
    assert.equal(resolveStoreValue({ vars, names: "SHOPIFY_THEME_ID", store: STORE, raw: "999" }).value, "999");
});

test("multiple names: every name's overrides are checked before raw", () => {
    const vars = { SHOPIFY_PRODUCTION_THEME_ID__PRODUCTION_HERSCHEL_US: "555" };
    const r = resolveStoreValue({
        vars,
        names: "SHOPIFY_PREVIEW_BASE_THEME_ID SHOPIFY_PRODUCTION_THEME_ID",
        store: STORE,
        raw: "777",
    });
    assert.equal(r.value, "555");
    assert.equal(lookupStoreVar(vars, "A,B", STORE, "").source, "empty");
});

test("without names it behaves like the original raw resolver", () => {
    const vars = { THEME_ROOT__PRODUCTION_HERSCHEL_US: "ignored" };
    assert.equal(resolveStoreValue({ vars, store: STORE, raw: "scalar" }).value, "scalar");
    assert.equal(resolveStoreValue({ vars, store: STORE, raw: '{"other":"x"}' }).value, "");
    assert.equal(resolveStoreValue({ vars, store: STORE, raw: '{"production-herschel-us.myshopify.com":5}' }).value, "5");
    assert.equal(resolveStoreValue({ vars, store: STORE, raw: "" }).source, "empty");
    assert.throws(() => resolveStoreValue({ store: STORE, raw: "{not json}" }));
});

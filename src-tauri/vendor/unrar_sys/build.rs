fn main() {
    // VENDORED PATCH: decide by the *target* (CARGO_CFG_TARGET_*), not by the build machine
    // (`cfg!(windows)`), so cross-building for Windows from Linux works. See VENDORED.md.
    let target_windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    let target_gnu = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu");
    if target_windows {
        // System libraries the Windows code uses (isnt.cpp, os.hpp pragmas, registry/crypto/shell calls).
        for lib in ["powrprof", "shell32", "shlwapi", "advapi32", "ole32", "oleaut32", "wbemuuid"] {
            println!("cargo:rustc-link-lib={lib}");
        }
        if target_gnu {
            println!("cargo:rustc-link-lib=pthread");
        }
    } else {
        println!("cargo:rustc-link-lib=pthread");
    }
    let files: Vec<String> = [
        "strlist",
        "strfn",
        "pathfn",
        "smallfn",
        "global",
        "file",
        "filefn",
        "filcreat",
        "archive",
        "arcread",
        "unicode",
        "system",
        "crypt",
        "crc",
        "rawread",
        "encname",
        "match",
        "timefn",
        "rdwrfn",
        "consio",
        "options",
        "errhnd",
        "rarvm",
        "secpassword",
        "rijndael",
        "getbits",
        "sha1",
        "sha256",
        "blake2s",
        "hash",
        "extinfo",
        "extract",
        "volume",
        "list",
        "find",
        "unpack",
        "headers",
        "threadpool",
        "rs16",
        "cmddata",
        "ui",
        "filestr",
        "scantree",
        "dll",
        "qopen",
    ].iter().map(|&s| format!("vendor/unrar/{s}.cpp")).collect();
    let mut files = files;
    if target_windows {
        // VENDORED PATCH: was `#[cfg(windows)]` (build machine); now by target.
        files.push("vendor/unrar/isnt.cpp".to_string());
    }
    cc::Build::new()
        .cpp(true) // Switch to C++ library compilation.
        .opt_level(2)
        .std("c++14")
        // by default cc crate tries to link against dynamic stdlib, which causes problems on windows-gnu target
        .cpp_link_stdlib(None)
        .warnings(false)
        .extra_warnings(false)
        .flag_if_supported("-stdlib=libc++")
        .flag_if_supported("-fPIC")
        .flag_if_supported("-Wno-switch")
        .flag_if_supported("-Wno-parentheses")
        .flag_if_supported("-Wno-macro-redefined")
        .flag_if_supported("-Wno-dangling-else")
        .flag_if_supported("-Wno-logical-op-parentheses")
        .flag_if_supported("-Wno-unused-parameter")
        .flag_if_supported("-Wno-unused-variable")
        .flag_if_supported("-Wno-unused-function")
        .flag_if_supported("-Wno-missing-braces")
        .flag_if_supported("-Wno-unknown-pragmas")
        .flag_if_supported("-Wno-deprecated-declarations")
        .define("_FILE_OFFSET_BITS", Some("64"))
        .define("_LARGEFILE_SOURCE", None)
        .define("RAR_SMP", None)
        .define("RARDLL", None)
        .files(&files)
        .compile("libunrar.a");
}

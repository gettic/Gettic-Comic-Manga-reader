//! Natural sort for page names: "page2" before "page10", case-insensitive,
//! compared folder by folder ("ch2/x" before "ch10/a").

use std::cmp::Ordering;

/// Compares two `/`-separated paths naturally.
pub fn compare(a: &str, b: &str) -> Ordering {
    let mut ca = a.split('/');
    let mut cb = b.split('/');
    loop {
        match (ca.next(), cb.next()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) => match compare_part(x, y) {
                Ordering::Equal => {}
                o => return o,
            },
        }
    }
}

fn compare_part(a: &str, b: &str) -> Ordering {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let si = i;
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let na = trim_zeros(&a[si..i]);
            let nb = trim_zeros(&b[sj..j]);
            let o = na.len().cmp(&nb.len()).then_with(|| na.cmp(nb));
            if o != Ordering::Equal {
                return o;
            }
            // Same number: fewer leading zeros first ("1" before "01").
            let o = (i - si).cmp(&(j - sj));
            if o != Ordering::Equal {
                return o;
            }
        } else {
            let x = a[i].to_lowercase().next().unwrap_or(a[i]);
            let y = b[j].to_lowercase().next().unwrap_or(b[j]);
            if x != y {
                return x.cmp(&y);
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}

fn trim_zeros(d: &[char]) -> &[char] {
    let n = d.iter().take_while(|c| **c == '0').count();
    &d[n.min(d.len().saturating_sub(1))..]
}

#[cfg(test)]
mod tests {
    use super::compare;

    fn sorted(v: &[&str]) -> Vec<String> {
        let mut v: Vec<String> = v.iter().map(|s| s.to_string()).collect();
        v.sort_by(|a, b| compare(a, b));
        v
    }

    #[test]
    fn numbers_compare_by_value() {
        assert_eq!(sorted(&["page10.jpg", "page2.jpg", "page1.jpg"]), ["page1.jpg", "page2.jpg", "page10.jpg"]);
    }

    #[test]
    fn case_and_zeros() {
        assert_eq!(sorted(&["B.png", "a.png", "001.png", "1.png", "02.png"]), ["1.png", "001.png", "02.png", "a.png", "B.png"]);
    }

    #[test]
    fn folders_compare_per_component() {
        assert_eq!(sorted(&["ch10/a.jpg", "ch2/z.jpg", "ch2/b.jpg"]), ["ch2/b.jpg", "ch2/z.jpg", "ch10/a.jpg"]);
    }

    #[test]
    fn long_numbers_do_not_overflow() {
        assert_eq!(sorted(&["99999999999999999999999.png", "1.png"]), ["1.png", "99999999999999999999999.png"]);
    }
}
